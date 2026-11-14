// OpenIsland v3.0.0 — main process
// Free, original Dynamic Island / notch for Windows. No account, no ads, no telemetry.
// Windows-only helpers live in src/helpers/win/*.ps1 and are invoked via PowerShell
// only when running on Windows; on other platforms they degrade gracefully and say so.
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, clipboard,
  screen, shell, desktopCapturer, safeStorage, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const http = require('http');
const QRCode = require('qrcode');

const IS_WIN = process.platform === 'win32';
// Item 16: no menu bar anywhere, ever — Electron's default File/Edit/View/
// Window/Help menu (and its File > Exit trap, which quit the whole app from
// Settings) is removed at startup and on every window (belt-and-braces:
// setApplicationMenu(null) + win.setMenu(null) + autoHideMenuBar:true).
try { Menu.setApplicationMenu(null); } catch { /* before app ready on some versions — whenReady repeats it */ }
const USER_DATA = app.getPath('userData');
const SETTINGS_PATH = path.join(USER_DATA, 'settings.json');
const CLIP_PATH = path.join(USER_DATA, 'clipboard.json');
const SHELF_PATH = path.join(USER_DATA, 'shelf.json');
const REMINDERS_PATH = path.join(USER_DATA, 'reminders.json');
// v5.0.0 (item A4): a small append-only diagnostic log in userData, so a
// scope hide/show or a helper failure can be diagnosed from the user's own
// machine without any UI surface ever showing a raw path or stderr.
const LOG_PATH = path.join(USER_DATA, 'openisland.log');
function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    // Keep the log small: when it passes 256 KB, keep only the last ~128 KB.
    try {
      if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 262144) {
        const tail = fs.readFileSync(LOG_PATH, 'utf8').slice(-131072);
        fs.writeFileSync(LOG_PATH, tail.replace(/^[^\n]*\n/, ''));
      }
    } catch { /* rotation is best-effort */ }
    fs.appendFileSync(LOG_PATH, line);
  } catch { /* logging must never break the app */ }
  console.log('[openisland] ' + msg);
}
const DECK_PORT = 8177;   // phone deck + file share (LAN)
const LOCAL_PORT = 8178;  // localhost-only script/CLI endpoint

const DEFAULT_SETTINGS = {
  general: { runAtStartup: false, language: 'en', firstRun: true, tourDone: false },
  accessibility: { reduceMotion: false, largerText: false },
  appearance: { theme: 'liquid-glass', accent: '#ffffff', cornerRadius: 48, surface: 100, motion: 'balanced', visualizer: 'pixels', borderWallpaper: '' }, // v1.0.0: default accent is white (the reference look); the old purple default is gone. surface: see-through 0-100 (f-04); borderWallpaper: '' | 'preset:<id>' | 'file:<name in USER_DATA/wallpapers>'; cornerRadius 48 = 100% fully round (settings maps cornerRadius/48*100); motion 'fluid'|'balanced'|'battery-saver'; visualizer 'pixels'|'bars'
  island: {
    shape: 'pill',            // 'pill' | 'notch'
    position: 'top-center',   // 'top-left' | 'top-center' | 'top-right'
    width: 206, expandedWidth: 600, expandedHeight: 460, // v1.0.0: collapsed pill 206x35 and ONE shared expanded width 600 @1920, per the reference video (measured: pill ~137px @1276, card ~399px @1276)
    clickThroughWhenCollapsed: true,
    clickThroughMode: 'off',  // 'off' | 'hold-ctrl' — hold Ctrl to interact, clicks pass through otherwise
    scope: 'desktop',         // v5.0.3 (item 8): desktop-only, permanently — the island is a desktop widget, never over any app
    hiddenUntilEdge: false,   // hidden until pointer rests on top edge
    openDelayMs: 350,
    openTab: 'last',          // 'last' | 'music' — which tab the island opens on (f-07)
    perAppRules: [],          // { exe: 'valorant.exe', mode: 'hide'|'strip'|'step-aside'|'show' }
  },
  panels: { music: true, widgets: true, controls: true, clipboard: true, files: true, reminders: true, calls: true, gaming: true, deck: false, stream: false, web: true, notifications: true }, // v5.0.0 (item B2): the Stream tab key is `stream` (what applyTabs reads) — the old `streaming: false` key was dead weight nothing read, so the tab showed by default; now deck AND stream are off by default, the other 10 on
  widgets: { clock24h: false, weatherLat: 17.3850, weatherLon: 78.4867, weatherUseLocation: false, desktopClock: true, desktopWeather: true, desktopStats: true, accent: '#ffffff' }, // v1.0.0: widget accent is white (the old purple default is gone). desktop* default ON for fresh installs only — loadSettings deepMerge preserves a stored false
  calls: { micMuted: false, showPrivacyDot: true },
  gaming: { mode: 'strip', fpsSource: 'none', showStrip: true, stripPosition: 'top-left', fpsConsent: 'unset', slimStripMaximized: false }, // 'hide' | 'strip' | 'nothing'
  taskbar: { enabled: false, hideWindowsTaskbar: false, autoHideOnSide: false, showAllTrayIcons: true, pinned: [] }, // pinned defaults to [] — the real pinned apps are read from disk (see migratePinnedApps); never ship fake defaults here
  liveWallpaper: { enabled: false, file: '', quality: 'balanced', fps: 30, pauseOnFullscreen: true, pauseOnBattery: true, pauseOnSaver: true }, // opt-in, off by default
  webDrawer: [], // { name, url } — pinned sites, opened in the default browser (reliable option)
  streaming: { enabled: false, twitchChannel: '', youtubeUrl: '', obsEnabled: false, obsHost: '127.0.0.1', obsPort: 4455, obsPassword: '', renderFolder: '' },
  lyrics: { enabled: false },
  keys: { toggleIsland: 'CommandOrControl+Alt+N', muteMic: 'CommandOrControl+Alt+M', colorPicker: 'CommandOrControl+Alt+C', toggleGameStrip: 'CommandOrControl+Alt+G' },
  favourites: [null, null, null, null, null, null], // { name, path, hotkey } x6
  deck: { enabled: false, allowedPhones: [] },
  tools: { recordMic: false },
};
// The v2 default pinned list (removed in v3 — pinned now defaults to [] and
// is migrated from the real taskbar pins on disk). Used only to recognise a
// settings file that still carries the v2 defaults, so migration runs once.
// NOTE: this block MUST stay above `let settings = loadSettings()` —
// loadSettings() runs at module load and references these bindings, and
// const/let are not hoisted: if they sat below that line, the reference
// would throw (temporal dead zone), loadSettings' try/catch would swallow
// it, and the app would silently start on fresh defaults every launch.
// (Caught by the xvfb smoke test 2026-11-13: a seeded settings file with
// tourDone=true and all desktop widgets off was ignored until this moved.)
const V2_DEFAULT_PINNED = [
  { name: 'File Explorer', path: 'C:\\Windows\\explorer.exe' },
  { name: 'Notepad', path: 'C:\\Windows\\System32\\notepad.exe' },
  { name: 'Edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
];
function isV2DefaultPinned(list) {
  if (!Array.isArray(list) || list.length !== V2_DEFAULT_PINNED.length) return false;
  return V2_DEFAULT_PINNED.every((d, i) => list[i] && list[i].name === d.name && list[i].path === d.path);
}
// Set by loadSettings when the stored pinned list is exactly the v2 defaults;
// migratePinnedApps() (async, Windows-only, at startup) replaces it with the
// real pinned apps read from disk. Until then pinned is [] — never the fakes.
let pinnedMigrationPending = false;
let settings = loadSettings();
let lastVolumeLevel = null; // v1.0.0 (item B): last-known master volume level, for the volume.ps1 keybd_event set fallback (the from-level).
let clipHistory = loadJson(CLIP_PATH, []);
let shelf = loadJson(SHELF_PATH, []);
let reminders = loadJson(REMINDERS_PATH, []);

let islandWin, settingsWin, reminderWin, gameStripWin, snipWin, tourWin;
let widgetWins = {};
let tray = null;
let deckServer = null, localServer = null;
// Foreground watcher state (one 500ms Windows poll drives per-app rules,
// desktop-only scope, slim-strip-under-maximised, live-wallpaper pause and
// the dock step-aside — instead of four separate polls).
let foregroundState = null; // {process,title,class,isFullscreen,isMaximized} | null (non-Windows)
// v5.0.0 (item F): true while a REAL fullscreen app is the foreground window
// (foreground.ps1 isFullscreen = the window rect covers the whole screen; a
// merely maximised window is NOT fullscreen). While true, the island stays
// visible on top but is click-through unless Ctrl is held — the automatic
// version of the manual hold-Ctrl mode. Our own windows + system overlays
// never count (the A1/A2 exemptions apply here too).
let fullscreenForeground = false;
let foregroundPoll = null;
// v5.0.1 (item 3): timestamp of the last COMPLETED foreground reading.
// A poll that never completes (hung helper, dead interval) leaves this
// stale — the stale-state watchdog below treats that as "unknown" and
// fails OPEN instead of leaving the island/dock hidden on a stale state.
let fgLastReadingAt = 0; // ms epoch; 0 = no reading yet
let fgHasReading = false; // true once the first reading completed
let fgStaleFailOpenLogged = false; // the watchdog logs its fail-open once per episode
let safetyWatchdog = null; // 1s interval enforcing the "never neither taskbar" invariant
let lastAppliedRule = null; // exe of the rule currently applied (or '__none__')
// v5.0.0 (item F): the scope the rules were last evaluated against — a
// scope flip invalidates the cached rule key (see applySettingsSideEffects).
let lastScopeSetting = null;
let stepAsideActive = false;
// Live wallpaper (opt-in, off by default).
let wallpaperWin = null, wallpaperAttached = false, wallpaperAttachFails = 0, wallpaperPaused = false;
let lastPowerState = null; // {acOnline, saverOn, batteryPct}
// Taskbar dock (optional, off by default).
let dockWin = null, dockRunning = [], dockPoll = null;
// OBS (obs-websocket-js; off by default).
let obsClient = null, obsState = { connected: false, recording: false, streaming: false, recordMs: 0, scene: '', error: '' };
let obsRetryTimer = null;
// Render-folder watch.
let renderWatcher = null, renderScanTimer = null, renderState = { folder: '', latest: null };
// Notifications (the island's own, persisted; Windows toasts via helper).
const NOTIF_PATH = path.join(USER_DATA, 'notifications.json');
let appNotifications = loadJson(NOTIF_PATH, []);
// FPS (DWM composition rate; consent-gated, heuristic-gated).
let fpsSamples = []; // last two non-null samples
let currentFps = null;
// v2.0.0 — collapse authority: while the island is expanded, the main process
// polls the real cursor position (renderer :hover is unreliable on Windows for
// a transparent frameless window). expandCooldownUntil stops the expand/collapse
// loop when the cursor is still sitting over the pill right after a collapse.
let islandCollapsed = true;
let cursorPoll = null;
let expandCooldownUntil = 0;
let hoverSince = 0;
let needLeaveBeforeHover = false;
// v5.0.2 (item 1): the cursor poll may collapse the expanded island ONLY
// after the pointer entered the island window at least once since this
// expand. Without this, a tray/hotkey expand with the pointer far away
// collapses on the first 150 ms tick (PJ, v5.0.1 verdict: the island
// would not stay open for 2 s). expandAt backs a 500 ms grace period.
let pointerEnteredSinceExpand = false;
let expandAt = 0;
// Feature B (v2.0.0): hold-Ctrl click-through + desktop-only scope.
let ctrlHeld = false;
let lastClipText = '';
let mediaState = { source: 'none', sessions: [], activeIndex: 0, error: null };
// Grace period for disappearing sessions (item 4e): Chrome's SMTC session is
// deleted ~0.8-1s after a skip and briefly title-less on transitions, so a
// session that vanishes from one poll is kept for MEDIA_GRACE_MS before it
// is dropped. Map: session id -> last-seen timestamp (ms).
const MEDIA_GRACE_MS = 1500;
let mediaLastSeen = new Map();
// v5.0.0: serialise the media poll too — media.ps1 (Add-Type + WinRT) takes
// ~1–3 s and the 2 s interval used to pile overlapping PowerShell processes
// onto the same stampede as the foreground poll, which could time the media
// helper out and flash "Media unavailable" with nothing playing.
let mediaPollInFlight = false;
// Dev/test hook only: OI_MOCK_MEDIA='<json>' pretends SMTC sessions exist
// (used for headless screenshots on Linux, where there is no SMTC).
if (process.env.OI_MOCK_MEDIA) { try { const m = JSON.parse(process.env.OI_MOCK_MEDIA); mediaState = { source: 'none', sessions: [], activeIndex: 0, error: null, ...m }; if (!Array.isArray(mediaState.sessions)) mediaState.sessions = []; } catch { /* bad mock: ignore */ } }
let isQuitting = false; // item 14: only the tray Quit sets this; closing a window never quits the app
let micInUse = false, camInUse = false, captureInUse = false;
let callStartTs = null;
let lastCpu = null;

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    if (raw && raw.taskbar && isV2DefaultPinned(raw.taskbar.pinned)) {
      pinnedMigrationPending = true;
      raw.taskbar.pinned = []; // drop the fake defaults now; real pins arrive async at startup
    }
    const merged = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), raw);
    // v5.0.3 (item 8): desktop-only is permanent — overwrite any stored
    // value, including 'all' from older versions.
    merged.island.scope = 'desktop';
    // v1.0.0 (item D, PJ 2026-11-14): the Windows taskbar hides ONLY when
    // the island taskbar is enabled — hide-on-its-own is gone. Overwrite
    // any stored true (PJ's own settings have hideWindowsTaskbar=true with
    // enabled=false, which hid his taskbar with no island taskbar).
    merged.taskbar.hideWindowsTaskbar = false;
    merged.taskbar.autoHideOnSide = false; // same rule: it hid the taskbar without the island taskbar on
    // v1.0.0: the default theme is now near-black glass with a white
    // accent. A stored accent that is just the OLD default purple is a
    // leftover, not a choice — migrate it to white so the reference look
    // applies. A deliberately picked accent is left alone.
    if (merged.appearance.accent === '#7c5cff' || merged.appearance.accent === '#8b7cff') merged.appearance.accent = '#ffffff';
    if (merged.widgets.accent === '#8b7cff') merged.widgets.accent = '#ffffff';
    // v5.0.0 one-time panels migration (item B2): settings files written by
    // v1 only knew 4 tabs; the v2-added tabs were stored as false and later
    // defaults never migrated a stored false — so the strip showed only 4
    // icons. On the first v5 run, reset panels to the current defaults
    // (music/widgets/controls/clipboard/files/reminders/calls/gaming/web/
    // notifications ON; deck/stream OFF). Settings → Panels can still turn
    // any tab off afterwards. A marker file makes it run exactly once.
    const marker = path.join(USER_DATA, '.panels-migrated-v5');
    if (!fs.existsSync(marker)) {
      merged.panels = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.panels));
      try {
        fs.mkdirSync(USER_DATA, { recursive: true });
        fs.writeFileSync(marker, new Date().toISOString());
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2));
      } catch { /* migration is best-effort; the in-memory settings still apply */ }
      logLine('panels migrated to v5 defaults (one-time): all 10 default tabs on, deck/stream off');
    }
    return merged;
  } catch (e) { console.error('[openisland] loadSettings failed, using defaults:', e && e.message); return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
}
function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') deepMerge(base[k], over[k]);
    else base[k] = over[k];
  }
  return base;
}
function saveSettings() { fs.mkdirSync(USER_DATA, { recursive: true }); fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2)); }
function loadJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function saveJson(p, v) { fs.mkdirSync(USER_DATA, { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); }

// ---------- Island border wallpaper (Feature A, v2.0.0) ----------
// The wallpaper lives ONLY in the island's frame ring (a #frame layer behind
// the content, inset by the border width) — the inside stays transparent
// glass. Files are copied into USER_DATA/wallpapers so they survive the
// original being moved or deleted. Theme-independent: a theme change never
// touches --border-img.
const WALLPAPERS_DIR = path.join(USER_DATA, 'wallpapers');
const BORDER_PRESETS = {
  aurora: 'linear-gradient(135deg, #7c5cff, #00c6ff 45%, #ff5fa2)',
  sunset: 'linear-gradient(135deg, #ff9a3d, #ff5e7a 55%, #b06bff)',
  ocean: 'linear-gradient(135deg, #00b4d8, #0077ff 50%, #00e5a0)',
  forest: 'linear-gradient(135deg, #2ecc71, #0a7a5c 55%, #a8e063)',
  mono: 'linear-gradient(135deg, #ffffff, #8e8e93 60%, #3a3a3f)',
};
let borderCache = { value: null, css: 'none' };
function borderWallpaperCssValue() {
  const v = settings.appearance.borderWallpaper || '';
  if (borderCache.value === v) return { css: borderCache.css };
  let css = 'none';
  if (v.startsWith('preset:')) css = BORDER_PRESETS[v.slice(7)] || 'none';
  else if (v.startsWith('file:')) {
    try {
      const file = path.join(WALLPAPERS_DIR, path.basename(v.slice(5)));
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) {
        const { width, height } = img.getSize();
        const scale = Math.min(1, 512 / Math.max(width, height));
        const small = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }) : img;
        css = `url(${small.toDataURL()})`;
      }
    } catch { css = 'none'; }
  }
  borderCache = { value: v, css };
  return { css };
}
function pushBorderWallpaper() {
  islandWin?.webContents.send('border-wallpaper', borderWallpaperCssValue());
}
// Live-apply (v2.0.0): every settings change is pushed to the island (and to
// the Settings window itself) the moment it happens — there is no Save step.
// The island re-applies theme/accent/radius/shape/tabs from this payload.
function pushSettingsToIsland() {
  islandWin?.webContents.send('settings-updated', settings);
  settingsWin?.webContents.send('settings-updated', settings);
}

// ---------- Click-through (Feature B, v2.0.0) ----------
// v5.0.0 (item F): effective hold-Ctrl = the manual setting OR a fullscreen
// app in front. Either one makes the island click-through (clicks pass to the
// app underneath, hover does not expand) until Ctrl is held. When no
// fullscreen app is in front, normal behaviour resumes immediately.
// hold-ctrl mode: the island ALWAYS ignores mouse events (collapsed AND
// expanded) unless Ctrl is held — clicks land on the app underneath, no hover
// exceptions (same rule as the Interview Overlay). The renderer reports the
// Ctrl state from forwarded mousemove events (they carry event.ctrlKey).
function effectiveHoldCtrl() {
  return settings.island.clickThroughMode === 'hold-ctrl' || fullscreenForeground;
}
// Last value passed to setIgnoreMouseEvents (for the debug-state test hook;
// there is no Electron getter for it).
let lastIgnoreMouseEvents = null;
function applyClickThrough() {
  if (!islandWin) return;
  const ignore = effectiveHoldCtrl() ? !ctrlHeld : (islandCollapsed && settings.island.clickThroughWhenCollapsed);
  lastIgnoreMouseEvents = ignore;
  islandWin.setIgnoreMouseEvents(ignore, { forward: true });
}

// ---------- Foreground watcher (per-app rules, scope, slim strip, wallpaper, dock) ----------
// One 500ms Windows poll (foreground.ps1) drives everything that depends on
// which app is in front. On non-Windows the state stays null and every
// consumer falls back to its default (island shown, no rules applied).
// v5.0.0 (item A3): the poll is SERIALISED — a tick is skipped while one is
// in flight, and each poll carries a sequence number so a stale completion
// can never overwrite a newer state. The old unserialised poll spawned a
// fresh powershell.exe (Add-Type compile, ~1–3 s) every 500 ms, so dozens
// overlapped and results arrived late and out of order — the ~1 s delay
// before the pill appeared on the desktop and the "all of a sudden" vanish.
// v5.0.3 (item 2): an empty/error foreground reading. The helper prints
// {"error":"foreground check failed"} when it cannot read the foreground,
// and returns hwnd:0 with empty process/title/class when there is no
// foreground window. A missing hwnd ALONE is not empty — the rig stubs omit
// hwnd while carrying a real process/title/class, and the real helper always
// returns hwnd, so only hwnd:0 (no window) counts here.
function isEmptyForegroundReading(d) {
  if (!d) return true;
  if (d.error) return true;
  if (d.hwnd === 0) return true;
  if (!d.process && !d.title && !d.class) return true;
  return false;
}
let fgPollInFlight = false;
let fgPollSeq = 0;
// v1.0.0 (item C): foreground-helper health. The main helper (Add-Type C#
// compile, ~1-3 s per fresh powershell.exe) can fail persistently on a
// machine - v5.0.3 fail-open then kept the island visible over apps forever
// (PJ's video: the island over maximised Chrome for 52 s) with NO log line,
// because an error payload exits 0 and pollForeground never logged it.
// v1.0.1: the compile is GONE (foreground.ps1 uses UI Automation now, like
// the lite check) and the fail-closed rule is TIME-based, not count-based:
//   fgLastConfirmedAt — ms epoch of the last CONFIRMED reading from either
//     check, or a "noFocus" answer from the lite check (nothing has focus
//     is a meaningful desktop-like signal, not a failure). A "noFocus"
//     answer also resets the timer.
//   fgPersistentFailure — set when NO confirmed reading has arrived for
//     FG_FAIL_CLOSED_AFTER_MS (10 s): the island HIDES (fail-closed)
//     instead of sitting over apps forever. Cleared the moment any confirmed
//     reading (or noFocus) arrives.
//   Why time, not count: the old 10-consecutive-ticks counter never fired
//     on PJ's machine - a slow helper made each tick 15 s long, and any
//     single noFocus reading reset the count to zero, so 3 minutes of
//     continuous failure never reached 10 ticks. A wall-clock timer cannot
//     be reset by one lucky reading and cannot be stretched by a slow helper.
//   A "noFocus" answer from the lite check is a meaningful desktop-like
//   signal (nothing has focus) - it resets the timer, it is not a failure.
const FG_FAIL_CLOSED_AFTER_MS = 10000;
let fgLastConfirmedAt = 0; // ms epoch; 0 = no confirmed reading yet
let fgPersistentFailure = false;
let fgLastMainErr = ''; // last main-helper error text (for the fail-closed log line)
let fgLastLiteErr = ''; // last lite-helper error text (same)
let fgLiteFallbackLogged = false;
let fgFailClosedLogged = false;
let fgSlowLoggedAt = 0;
// Dev/test hook for the lite fallback (same pattern as OI_TEST_FOREGROUND):
// OI_TEST_FOREGROUND_LITE=<path> feeds a stubbed lite result so the
// fallback + fail-closed path can be verified on Linux. Without it the lite
// fallback only runs on real Windows.
async function readForegroundLite(timeoutMs = 2000) {
  const testLite = process.env.OI_TEST_FOREGROUND_LITE;
  if (testLite) {
    try { return { ok: true, data: JSON.parse(fs.readFileSync(testLite, 'utf8')) }; }
    catch { return { ok: false, error: 'lite stub unreadable' }; }
  }
  // v1.0.2: the lite check runs inside the persistent helper process too
  // (same 2 s backstop); the per-call spawn is only the fallback when the
  // process cannot start at all.
  return queryForegroundLite(timeoutMs);
}
// v1.0.1: time-based fail-closed. If neither foreground check has returned
// a confirmed reading (or a noFocus desktop-like signal) for
// FG_FAIL_CLOSED_AFTER_MS, the island hides instead of sitting over apps
// forever. Called from pollForeground's failure path AND from the freshness
// watchdog, so it fires even when a poll is stuck behind a hung helper.
// Idempotent: once set, only a confirmed reading clears it.
function maybeFailClosed(mainErr, liteErr) {
  if (fgPersistentFailure) return;
  if (fgLastConfirmedAt === 0) return; // watcher not started yet; grace period
  const elapsedMs = Date.now() - fgLastConfirmedAt;
  if (elapsedMs < FG_FAIL_CLOSED_AFTER_MS) return;
  fgPersistentFailure = true;
  if (!fgFailClosedLogged) {
    fgFailClosedLogged = true;
    logLine(`foreground: NO confirmed reading for ${Math.round(elapsedMs / 1000)}s (main: ${(mainErr || 'empty').slice(0, 120)}; lightweight: ${(liteErr || 'empty').slice(0, 120)}) — hiding island (fail-closed); it shows again when a reading arrives`);
  }
}
async function pollForeground() {
  // Dev/test hook only: OI_TEST_FOREGROUND=<path to a JSON file> feeds a
  // stubbed foreground state ({process,title,class,isFullscreen,isMaximized})
  // so scope/fullscreen behaviour can be verified on Linux, where the real
  // PowerShell helper cannot run. The stub flows through the exact same
  // code path (foregroundState → applyForegroundRules → wallpaper/dock).
  // Never set in production.
  const testFg = process.env.OI_TEST_FOREGROUND;
  if (!IS_WIN && !testFg && !process.env.OI_FG_SERVER_CMD) return;
  if (fgPollInFlight) return; // skip the tick — the in-flight poll is fresher than a queue
  fgPollInFlight = true;
  const seq = ++fgPollSeq;
  try {
    // v5.0.1 (item 3): the stub read must NEVER throw out of the poll — a
    // missing/unreadable stub (the rig's "freeze" case) is a MISSING reading,
    // not a crash, and the stale-state watchdog below fail-opens on it.
    let r;
    const startedAt = Date.now();
    if (testFg) {
      try { r = { ok: true, data: JSON.parse(fs.readFileSync(testFg, 'utf8')) }; }
      catch { return; } // no reading arrived — timestamp stays stale on purpose
    } else {
      // v1.0.2: the foreground check runs inside the persistent helper
      // process (one powershell.exe, assemblies loaded once) and answers
      // in ~100-300 ms. The 2 s cap is a BACKSTOP only: a hung server is
      // killed + respawned by queryForegroundServer, so a slow helper can
      // never serialize the 500 ms poll behind it again. The per-call
      // spawn (psJson) is only the fallback when the process cannot start.
      r = await queryForegroundMain();
    }
    // v1.0.2: measure the helper. With the persistent process a reading
    // normally takes ~100-300 ms; a helper that takes >1 s per reading
    // still leaves a throttled timing line, so a slow machine stays
    // diagnosable (the v1.0.0 log showed 15.5 s - the Add-Type compile;
    // the v1.0.1 log showed 2.1 s - the per-poll process spawn).
    const tookMs = Date.now() - startedAt;
    if (tookMs > 1000 && Date.now() - fgSlowLoggedAt > 60000) {
      fgSlowLoggedAt = Date.now();
      logLine(`foreground: helper slow (${(tookMs / 1000).toFixed(1)}s per reading) — readings lag reality by this much`);
    }
    if (seq !== fgPollSeq) return; // stale completion — a newer poll already ran
    // A completed reading (good or failed) is fresh by definition: a failed
    // helper is fail-open immediately (null state shows the island), and the
    // timestamp records that the poll is alive.
    fgLastReadingAt = Date.now(); fgHasReading = true; fgStaleFailOpenLogged = false;
    // v1.0.0 (item C): the v5.0.3 gap was here — an error payload exits 0,
    // so runPs called it a success and NOTHING was logged, while
    // foregroundState stayed null (fail-open) forever. Now an error payload
    // is logged with its REAL text (logHelperFailure, throttled 1/60 s),
    // the lightweight fallback is tried in the same tick, and persistent
    // failure of BOTH checks fail-CLOSES (hides the island) instead of
    // leaving it over apps forever.
    const useLite = !testFg || !!process.env.OI_TEST_FOREGROUND_LITE;
    const confirmed = r.ok && r.data && !isEmptyForegroundReading(r.data);
    if (confirmed) {
      const d = r.data;
      foregroundState = {
        hwnd: d.hwnd, title: String(d.title || ''), class: String(d.class || ''),
        process: String(d.process || '').toLowerCase(),
        isFullscreen: !!d.isFullscreen, isMaximized: !!d.isMaximized,
      };
      if (fgPersistentFailure) logLine(`foreground: confirmed reading restored (${foregroundState.process || '?'} "${(foregroundState.title || '').slice(0, 40)}") — fail-closed cleared, normal scope rules resume`);
      fgLastConfirmedAt = Date.now(); fgPersistentFailure = false; fgFailClosedLogged = false; fgLiteFallbackLogged = false;
    } else {
      const errText = (!r.ok ? (r.error || '') : (r.data && r.data.error ? String(r.data.error) : ''));
      if (errText) logHelperFailure('foreground.ps1', errText);
      fgLastMainErr = errText || '';
      if (!useLite) {
        // Test-stub path (old suites): v5.0.3 behaviour exactly — no
        // fallback, fail-open. The time-based fail-closed still applies:
        // if no confirmed reading arrives for 10 s, the island hides.
        foregroundState = null;
        maybeFailClosed(errText, '');
      } else {
        const lite = await readForegroundLite();
        const liteConfirmed = lite.ok && lite.data && !isEmptyForegroundReading(lite.data);
        if (liteConfirmed) {
          const d = lite.data;
          foregroundState = {
            hwnd: d.hwnd, title: String(d.title || ''), class: String(d.class || ''),
            process: String(d.process || '').toLowerCase(),
            isFullscreen: !!d.isFullscreen, isMaximized: !!d.isMaximized,
          };
          if (!fgLiteFallbackLogged) {
            fgLiteFallbackLogged = true;
            logLine(`foreground: main helper failing (${(errText || 'empty reading').slice(0, 120)}) — using lightweight check (UIAutomation, no Add-Type compile)`);
          }
          fgLastConfirmedAt = Date.now(); fgPersistentFailure = false; fgFailClosedLogged = false;
        } else if (lite.ok && lite.data && lite.data.noFocus) {
          // Nothing has focus: desktop-like. A meaningful signal, not a
          // failure — the timer resets and the island shows.
          foregroundState = null;
          fgLastConfirmedAt = Date.now(); fgPersistentFailure = false; fgFailClosedLogged = false;
        } else {
          const liteErr = (!lite.ok ? (lite.error || '') : (lite.data && lite.data.error ? String(lite.data.error) : ''));
          if (liteErr) logHelperFailure('foreground-lite.ps1', liteErr);
          fgLastLiteErr = liteErr || '';
          foregroundState = null;
          maybeFailClosed(errText, liteErr);
        }
      }
    }
    applyForegroundRules();
    evaluateWallpaperPause();
    applyDockStepAside();
  } finally { fgPollInFlight = false; }
}
// v5.0.0 (items A1/A2): windows that must NEVER hide the island under
// desktop-only scope. Our OWN windows first — the island is focusable, so
// the moment PJ clicks or drags anything on it, it becomes the foreground
// window (process openisland, class Chrome_WidgetWin_1) and the old code
// hid the whole island on the next poll ("closed all of a sudden"). Then
// transient system overlays — opening the screenshot tool (Win+Shift+S)
// made the Snipping Tool foreground and hid the island mid-screenshot.
// Only a REAL third-party app window hides the island now.
const SCOPE_OVERLAY_PROCESSES = new Set([
  'snippingtool',           // Snipping Tool (Win+Shift+S overlay)
  'startmenuexperiencehost', // Start menu
  'searchhost', 'searchui',  // Windows Search
  'shellexperiencehost',     // Action Center / notifications / Quick Settings
  'widgets',                 // Widgets board
  'lockapp',                 // Lock screen
  'textinputhost',           // Touch keyboard / input host
]);
const SCOPE_OVERLAY_CLASSES = new Set([
  'ScreenClippingWindow',      // Snip & Sketch / Snipping Tool clipping overlay
  'MultitaskingViewFrame',     // Alt+Tab / Task View
  'XamlExplorerHostIslandWindow', // Widgets board host window
]);
function isScopeExempt(d) {
  if (!d) return true; // fail-open: no info at all still counts as desktop
  const proc = (d.process || '').toLowerCase();
  if (proc === 'openisland') return true; // our own window (island, Settings, dock, strip, widgets…)
  if (SCOPE_OVERLAY_PROCESSES.has(proc)) return true;
  if (SCOPE_OVERLAY_CLASSES.has(d.class || '')) return true;
  return false;
}
function startForegroundWatcher() {
  if (foregroundPoll) return;
  if (!IS_WIN && !process.env.OI_TEST_FOREGROUND && !process.env.OI_FG_SERVER_CMD) return;
  // v1.0.1: the fail-closed timer starts here — 10 s of grace from launch
  // before "no confirmed reading" can hide the island.
  fgLastConfirmedAt = Date.now();
  foregroundPoll = setInterval(() => { pollForeground(); checkForegroundFreshness(); }, 500);
  if (foregroundPoll.unref) foregroundPoll.unref();
  pollForeground();
}
// v5.0.1 (item 3): stale-state watchdog — if no foreground reading has
// COMPLETED within 5 s, the state in hand is stale and must not keep the
// island or the dock hidden. Treat the foreground as unknown (fail OPEN:
// show island + dock) and log it. A fresh reading clears the episode, so
// the watchdog can fire again later. Runs on the same 500 ms cadence as
// the poll, so it fires within ~5 s of the last good reading.
function checkForegroundFreshness() {
  if (!fgHasReading) return;
  if (Date.now() - fgLastReadingAt <= 5000) return;
  // v1.0.1: the fail-closed timer is evaluated here too, so it fires even
  // when a poll is stuck behind a hung helper and never completes. The
  // stored last error texts go into the log line.
  maybeFailClosed(fgLastMainErr, fgLastLiteErr);
  // v1.0.0 (item C): a stale reading while ALREADY fail-closed stays hidden
  // — fail-opening here would undo the persistent-failure hide.
  if (fgPersistentFailure) {
    if (!fgStaleFailOpenLogged) {
      fgStaleFailOpenLogged = true;
      logLine('foreground: no fresh reading for 5s AND persistent failure — staying hidden (fail-closed)');
    }
    applyForegroundRules();
    applyDockStepAside();
    return;
  }
  if (fgStaleFailOpenLogged) return;
  fgStaleFailOpenLogged = true;
  foregroundState = null;
  logLine(`foreground: no fresh reading for 5s (last ${Math.round((Date.now() - fgLastReadingAt) / 1000)}s ago) — fail-open, showing island + dock`);
  applyForegroundRules();
  applyDockStepAside();
}
// v5.0.1 (item 3): the safety invariant, enforced every second — the user
// must NEVER be left with neither taskbar. If the Windows taskbar is hidden
// AND neither the island nor the dock is visible, restore the Windows
// taskbar automatically and log it. (On non-Windows windowsTaskbarHidden is
// always false, so this is a no-op in the Linux rig — the restore path is
// Windows-only and stays PJ-verified.)
let safetyNoReplacementTicks = 0; // consecutive 1 s ticks with no replacement on screen
function startSafetyWatchdog() {
  if (safetyWatchdog) return;
  safetyWatchdog = setInterval(() => {
    if (!IS_WIN || !windowsTaskbarHidden) { safetyNoReplacementTicks = 0; return; }
    if (!hasTaskbarReplacement()) {
      safetyNoReplacementTicks += 1;
      // v5.0.3 (item 3): one transient tick must not undo the hide — the
      // island can be hidden for a single poll while the foreground reading
      // settles. Restore only after 3 consecutive ticks with no replacement.
      // A single transient tick logs nothing (no spam).
      if (safetyNoReplacementTicks < 3) return;
      safetyNoReplacementTicks = 0;
      logLine('safety: Windows taskbar hidden but neither island nor dock visible — restoring the Windows taskbar');
      windowsTaskbarHidden = false; // the restore below re-verifies via the helper
      setWindowsTaskbarHidden(false, { announce: true }).catch(() => {});
    } else {
      safetyNoReplacementTicks = 0;
    }
  }, 1000);
  if (safetyWatchdog.unref) safetyWatchdog.unref();
}
function matchingRule() {
  const proc = foregroundState?.process || '';
  if (!proc) return null;
  for (const r of (settings.island.perAppRules || [])) {
    const exe = String(r.exe || '').toLowerCase().replace(/\.exe$/, '');
    if (exe && (proc === exe || proc === exe + '.exe')) return r;
  }
  return null;
}
// v5.0.3 (items 2+8): what counts as "the desktop is in front". A missing,
// empty or error reading counts as desktop (fail-open — hiding on a blank
// reading is the v5.0.2 bug); so do our own windows and system overlays
// (v5.0.0 items A1/A2), the shell (Progman/WorkerW), and Explorer with no
// window title. Anything else is a confirmed real app in front.
// v1.0.0 (item C): EXCEPT after persistent failure — when neither the main
// helper nor the lightweight fallback has returned a confirmed reading for
// 10 seconds, "unknown" no longer counts as desktop: the island hides
// (fail-closed) and manual shows are blocked, so the widget cannot sit over
// apps forever just because its foreground check is broken. A confirmed
// reading clears the flag immediately.
function isDesktopForeground(d) {
  if (fgPersistentFailure) return false;
  if (!d || isEmptyForegroundReading(d)) return true;
  if (isScopeExempt(d)) return true;
  if (d.class === 'Progman' || d.class === 'WorkerW') return true;
  if (d.process === 'explorer' && (d.title === '' || d.title === 'Program Manager')) return true;
  return false;
}
// v5.0.3 (item 8): a manual show (tray, hotkey, second instance,
// island-expand IPC) may only show the island when the desktop is in front
// or the foreground is unknown (fail-open). While a confirmed non-desktop
// app is in front it does nothing — the island appears when the desktop
// comes back. Collapsing is never gated.
function canShowIsland() {
  return isDesktopForeground(foregroundState);
}
function applyForegroundRules() {
  if (!islandWin) return;
  // v5.0.0 (item F): fullscreen detection, computed FIRST so it applies no
  // matter which branch below returns. A real fullscreen app in front (rect
  // covers the whole screen) makes the island click-through until Ctrl is
  // held; a merely maximised window is not fullscreen (isFullscreen is
  // false for it), and our own windows + system overlays never count.
  const fsNow = !!(foregroundState && !isScopeExempt(foregroundState) && foregroundState.isFullscreen);
  if (fsNow !== fullscreenForeground) {
    fullscreenForeground = fsNow;
    applyClickThrough();
    logLine(fsNow
      ? `fullscreen: fullscreen app in front (${foregroundState.process || '?'}) — island is click-through unless Ctrl is held`
      : 'fullscreen: no fullscreen app in front — normal interaction restored');
  }
  const rule = matchingRule();
  const key = rule ? rule.exe + ':' + rule.mode : '__none__';
  // v5.0.3 (item 8): desktop-only is permanent — no 'all' branch. The
  // island hides outright on a CONFIRMED non-desktop foreground, and shows
  // (fail-open, item 2) on an empty/error/unknown reading.
  {
    const d = foregroundState;
    if (!isDesktopForeground(d)) {
      if (islandWin.isVisible()) {
        islandWin.hide();
        logLine(`scope: island hidden — foreground ${d.process || '?'} "${(d.title || '').slice(0, 60)}" (${d.class || '?'}) is not the desktop`);
      }
      lastAppliedRule = key; return;
    }
    if (!islandWin.isVisible()) {
      islandWin.show();
      logLine(`scope: island shown — foreground ${d ? `${d.process || '?'} (${d.class || '?'})` : 'unknown (fail-open)'}`);
    }
  }
  // Slim strip under maximised windows (f-07): the island hides and only the
  // slim system strip stays, until the maximised window goes away.
  const slimMaximized = settings.gaming.slimStripMaximized && foregroundState &&
    (foregroundState.isMaximized || foregroundState.isFullscreen) &&
    foregroundState.process !== 'explorer' && foregroundState.class !== 'Progman' && foregroundState.class !== 'WorkerW';
  if (slimMaximized) {
    if (islandWin.isVisible()) {
      islandWin.hide();
      // v5.0.1 (item 3): this branch hid the island with NO log line — every
      // hide/show decision must leave a line in openisland.log.
      logLine(`scope: island hidden (slim strip under maximised window) — foreground ${foregroundState.process || '?'} "${(foregroundState.title || '').slice(0, 60)}" (${foregroundState.class || '?'})`);
    }
    if (settings.gaming.showStrip !== false) applyGameStrip();
    lastAppliedRule = key; return;
  }
  if (key === lastAppliedRule) return; // nothing changed since last tick
  lastAppliedRule = key;
  stepAsideActive = false;
  if (!rule || rule.mode === 'show') {
    if (!islandWin.isVisible()) islandWin.show();
    return;
  }
  if (rule.mode === 'hide') { islandWin.hide(); return; }
  if (rule.mode === 'strip') {
    islandWin.hide();
    if (settings.gaming.showStrip !== false) applyGameStrip();
    return;
  }
  if (rule.mode === 'step-aside') {
    // Collapse and move to the far corner so the app's content is uncovered.
    stepAsideActive = true;
    setIslandCollapsed(true);
    const b = islandBounds(true);
    islandWin.setBounds(b);
  }
}
// islandBounds honours the step-aside override (far corner, collapsed).
function applyScopePoll() { startForegroundWatcher(); }

// ---------- Windows PowerShell helpers ----------
// v3.0.1 ROOT CAUSE (image-72 / verdict 2): the helpers live in
// src/helpers/win/*.ps1 and were packed INSIDE app.asar. Electron's fs can
// read inside the archive, so fs.existsSync returned true — but
// powershell.exe is an EXTERNAL process and cannot read inside app.asar, so
// every helper failed with "file does not exist" in the INSTALLED build and
// the raw stderr (full internal path) was shown to the user as a toast.
// Fix: the helpers are unpacked to real files (package.json asarUnpack) and
// runPs resolves the real unpacked path when packaged. In dev (__dirname is
// a real folder) the path is unchanged.
// v3.0.1 (item L): a helper failure must NEVER surface raw stderr, file
// paths or PowerShell text in the UI. runPs returns only a short friendly
// message; the full detail goes to the main-process console (logs only).
function helperPath(scriptName) {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'helpers', 'win', scriptName);
  return path.join(__dirname, 'helpers', 'win', scriptName);
}
const HELPER_FRIENDLY_ERROR = {
  'volume.ps1': 'Volume control is unavailable right now',
  'brightness.ps1': 'Brightness control is unavailable right now',
  'media.ps1': 'Media info is unavailable right now',
  'media-control.ps1': 'Media control is unavailable right now',
  'gpu.ps1': 'GPU info is unavailable right now',
  'taskbar.ps1': 'Taskbar control is unavailable right now',
  'workarea.ps1': 'Work-area control is unavailable right now',
  'pinned-apps.ps1': 'Pinned apps are unavailable right now',
  'foreground.ps1': 'Window info is unavailable right now',
  'windows.ps1': 'Window control is unavailable right now',
  'power.ps1': 'Power info is unavailable right now',
  'power-mode.ps1': 'Power mode is unavailable right now',
  'net-state.ps1': 'Network info is unavailable right now',
  'net-toggle.ps1': 'Network control is unavailable right now',
  'nightlight.ps1': 'Night light is unavailable right now',
  'focus.ps1': 'Focus is unavailable right now',
  'mic-mute.ps1': 'Mic control is unavailable right now',
  'audio-devices.ps1': 'Audio devices are unavailable right now',
  'fps.ps1': 'FPS info is unavailable right now',
  'notifications.ps1': 'Notifications are unavailable right now',
  'privacy.ps1': 'Privacy info is unavailable right now',
  'wallpaper-attach.ps1': 'Wallpaper could not be attached',
  'affinity.ps1': 'Capture setting is unavailable right now',
  'netstat.ps1': 'Network stats are unavailable right now',
};
function runPs(scriptName, args = [], timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!IS_WIN) return resolve({ ok: false, error: 'Windows-only helper (not running on Windows)', output: '' });
    const script = helperPath(scriptName);
    if (!fs.existsSync(script)) {
      // v5.0.1 (item 5): a missing helper is a failure too — log it.
      logHelperFailure(scriptName, 'helper file missing: ' + script);
      return resolve({ ok: false, error: HELPER_FRIENDLY_ERROR[scriptName] || 'Helper is unavailable right now', output: '' });
    }
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          // Log the raw detail for diagnosis; the UI only ever sees the short message.
          // v1.0.1: a killed process means the timeout fired - say so, so a
          // hung helper is distinguishable from a helper that failed fast.
          const detail = (err.killed ? `helper timed out after ${timeoutMs}ms: ` : '') + (stderr || err.message || '');
          console.error(`[openisland] helper failed: ${scriptName}`, detail.trim().slice(0, 500));
          logHelperFailure(scriptName, detail);
          return resolve({ ok: false, error: HELPER_FRIENDLY_ERROR[scriptName] || 'Helper is unavailable right now', output: (stdout || '').trim() });
        }
        resolve({ ok: true, output: (stdout || '').trim() });
      });
  });
}
async function psJson(scriptName, args = [], timeoutMs = 15000) {
  const r = await runPs(scriptName, args, timeoutMs);
  if (!r.ok) return { ok: false, error: r.error };
  try { return { ok: true, data: JSON.parse(r.output) }; } catch { logHelperFailure(scriptName, 'bad JSON from helper: ' + String(r.output).slice(0, 500)); return { ok: false, error: 'bad JSON from helper', raw: r.output }; }
}
// v5.0.1 (item 5): helper failures go to openisland.log too — console.error
// is invisible in the packaged Windows app, so a failure on the user's
// machine left no trace anywhere. Throttled to one line per script per
// 60 s: foreground.ps1 is polled every 500 ms, and an unthrottled failure
// would write ~86 MB/day of identical lines. The first failure of an
// episode is always logged; the throttle only dedupes repeats.
const helperFailLogAt = new Map();
function logHelperFailure(scriptName, detail) {
  const now = Date.now();
  const last = helperFailLogAt.get(scriptName) || 0;
  if (now - last < 60000) return;
  helperFailLogAt.set(scriptName, now);
  logLine(`helper failed: ${scriptName} — ${String(detail || '').trim().slice(0, 500)}`);
}

// ---------- Persistent foreground helper process (v1.0.2) ----------
// v1.0.1 spawned a fresh powershell.exe per poll: on PJ's machine the
// spawn + .NET assembly load takes 2.1 s, but the poll capped each helper
// at 2 s — so the reading was killed before it arrived, no confirmed
// reading ever landed, and fail-closed hid the island every ~10 s (the
// open/close cycle in PJ's video). The same stale readings also showed
// the island over Chrome when a late "openisland" reading arrived while
// Chrome was actually in front. A marginal cap raise is not a fix.
// One long-lived powershell.exe (foreground-server.ps1) serves every check
// over stdin/stdout instead: the assemblies load once at startup and each
// request is just the UIA query (~100-300 ms).
// Protocol: main writes "main\n" or "lite\n" to stdin; the server writes
// exactly one JSON line to stdout per request. The 2 s cap stays as a
// BACKSTOP only: a reading that takes longer kills + respawns the server
// and logs it, so a hung helper can never serialize the 500 ms poll.
// Dev/test hook: OI_FG_SERVER_CMD="<command line>" spawns that command
// instead of powershell.exe (the rig's mock server, hidden_files/
// mock-fg-server.js) so the reader is exercised on Linux, where
// PowerShell does not exist. Never set in production.
let fgServer = null; // { proc, buf, pending, dead } or null when never started
let fgServerUnavailableLogged = false;
function fgServerSpec() {
  const override = process.env.OI_FG_SERVER_CMD;
  if (override) {
    const parts = override.trim().split(/\s+/);
    if (parts.length && parts[0]) return { cmd: parts[0], args: parts.slice(1) };
    return null;
  }
  if (!IS_WIN) return null;
  const script = helperPath('foreground-server.ps1');
  if (!fs.existsSync(script)) return null;
  return { cmd: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script] };
}
function startForegroundServer() {
  const spec = fgServerSpec();
  if (!spec) return false;
  try {
    const proc = spawn(spec.cmd, spec.args, { windowsHide: true });
    fgServer = { proc, buf: '', pending: null, dead: false };
    proc.stdout.on('data', (chunk) => {
      if (!fgServer || fgServer.proc !== proc) return;
      fgServer.buf += chunk.toString('utf8');
      let idx;
      while ((idx = fgServer.buf.indexOf('\n')) >= 0) {
        const line = fgServer.buf.slice(0, idx).trim();
        fgServer.buf = fgServer.buf.slice(idx + 1);
        const p = fgServer.pending; fgServer.pending = null;
        if (!p) continue; // unsolicited line — drop it, keep the 1:1 protocol
        clearTimeout(p.timer);
        if (!line) { p.resolve({ ok: false, error: 'empty response from foreground helper process' }); continue; }
        try { p.resolve({ ok: true, data: JSON.parse(line) }); }
        catch { p.resolve({ ok: false, error: 'bad JSON from foreground helper process' }); }
      }
    });
    // Server errors surface as error JSON lines on stdout; stderr is noise.
    proc.stderr.on('data', () => {});
    const fail = () => {
      if (!fgServer || fgServer.proc !== proc) return;
      fgServer.dead = true;
      const p = fgServer.pending; fgServer.pending = null;
      if (p) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'foreground helper process exited' }); }
    };
    proc.on('error', fail);
    proc.on('exit', fail);
    return true;
  } catch { return false; }
}
function stopForegroundServer() {
  if (!fgServer) return;
  const { proc, pending } = fgServer; fgServer = null;
  if (pending) { clearTimeout(pending.timer); pending.resolve({ ok: false, error: 'foreground helper process stopped' }); }
  try { proc.kill(); } catch { /* already gone */ }
}
// One request to the persistent server. Serialised: the foreground poll is
// serialised too, so at most one request is ever in flight; a second caller
// gets a fast error instead of queuing behind it.
function queryForegroundServer(kind, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (fgServer && fgServer.pending) return resolve({ ok: false, error: 'foreground helper process busy' });
    if (!fgServer || fgServer.dead) {
      if (!startForegroundServer()) {
        if (!fgServerUnavailableLogged) {
          fgServerUnavailableLogged = true;
          logLine('foreground: helper process unavailable — falling back to per-call spawn');
        }
        return resolve({ ok: false, error: 'foreground helper process unavailable' });
      }
    }
    const pending = { resolve, timer: null };
    pending.timer = setTimeout(() => {
      if (!fgServer || fgServer.pending !== pending) return; // already answered
      fgServer.pending = null;
      try { fgServer.proc.kill(); } catch { /* already gone */ }
      fgServer.dead = true;
      logLine('foreground: helper process restarted (reading timed out after 2000ms)');
      resolve({ ok: false, error: 'foreground helper process timed out' });
    }, timeoutMs);
    fgServer.pending = pending;
    try { fgServer.proc.stdin.write(kind + '\n'); }
    catch {
      clearTimeout(pending.timer);
      if (fgServer && fgServer.pending === pending) fgServer.pending = null;
      if (fgServer) fgServer.dead = true;
      resolve({ ok: false, error: 'foreground helper process write failed' });
    }
  });
}
// The per-call spawn path stays as the fallback when the persistent process
// cannot start at all (powershell missing) — never crash, never spin.
async function queryForegroundMain(timeoutMs = 2000) {
  const r = await queryForegroundServer('main', timeoutMs);
  if (r.ok || r.error !== 'foreground helper process unavailable') return r;
  return psJson('foreground.ps1', [], 2000);
}
async function queryForegroundLite(timeoutMs = 2000) {
  const r = await queryForegroundServer('lite', timeoutMs);
  if (r.ok || r.error !== 'foreground helper process unavailable') return r;
  return psJson('foreground-lite.ps1', [], 2000);
}

// ---------- System stats (honest, sampled) ----------
function cpuSample() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) for (const k in c.times) { total += c.times[k]; if (k === 'idle') idle += c.times[k]; }
  const now = { idle, total };
  let pct = null;
  if (lastCpu) { const dI = now.idle - lastCpu.idle, dT = now.total - lastCpu.total; if (dT > 0) pct = Math.round((1 - dI / dT) * 100); }
  lastCpu = now; return pct;
}
// v1.0.2: GPU is sampled at most every 10 s and never overlaps itself.
// getStats runs every 2 s and gpu.ps1 spawns a fresh powershell.exe per
// call (Get-Counter alone takes ~2 s), so the old code piled up powershell
// processes on a slow machine and timed out at 15 s. The GPU value is a
// slow-moving stat — the island shows the last-known value meanwhile —
// and a slow GPU read must never contend with the foreground poll.
// (The persistent foreground process does NOT serve gpu.ps1: a 2 s
// Get-Counter inside the server would stall foreground readings for 2 s.)
let lastGpuResult = { name: null, load: null, note: 'GPU load needs Windows (Get-Counter) or nvidia-smi' };
let lastGpuAt = 0;
let gpuInFlight = false;
async function getStats() {
  const cpu = cpuSample();
  const mem = { total: os.totalmem(), free: os.freemem(), usedPct: Math.round((1 - os.freemem() / os.totalmem()) * 100) };
  let gpu = { name: null, load: null, note: 'GPU load needs Windows (Get-Counter) or nvidia-smi' };
  if (IS_WIN) {
    if (!gpuInFlight && Date.now() - lastGpuAt >= 10000) {
      gpuInFlight = true;
      const r = await psJson('gpu.ps1', [], 30000);
      gpuInFlight = false;
      lastGpuAt = Date.now();
      // gpu.ps1 tries '\GPU Engine(*engtype_3D)\Utilization Percentage' first,
      // then the broad '\GPU Engine(*)\Utilization Percentage' (max across
      // engines). A null load means every counter path failed on this machine —
      // never a fake number; the strip/Widgets show "—" with this note.
      if (r.ok) lastGpuResult = { name: r.data.name || null, load: r.data.load ?? null, note: r.data.load == null ? (r.data.note || 'GPU counter unavailable on this machine (no 3D-engine counter)') : '' };
      else lastGpuResult = { name: null, load: null, note: r.error || 'GPU helper failed' };
    }
    gpu = lastGpuResult;
  } else {
    try {
      const out = await new Promise((res) => execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu', '--format=csv,noheader'], (e, s) => res(e ? '' : s)));
      if (out) { const [name, load] = out.trim().split(',').map(s => s.trim()); gpu = { name, load: parseInt(load, 10), note: '' }; }
    } catch { /* no nvidia-smi */ }
  }
  return { cpu, mem, gpu, fps: currentFps, fpsNote: currentFps == null ? 'FPS: DWM composition rate (borderless/windowed games only). "—" when no game is presenting, consent is off, or the game bypasses the compositor.' : '' };
}

// ---------- Media (SMTC on Windows, in-app player otherwise) ----------
// v2.0.0: multi-session — media.ps1 enumerates ALL sessions (GetSessions),
// so YouTube in Chrome/Edge, Spotify, VLC and any other app all show up.
//
// v3.0.0 diagnosis (item 4 — root causes found in code, not guessed):
//   (a) NOT a cause: pollMedia already runs every 2s from app ready
//       (setInterval(pollMedia, 2000)) regardless of whether the island is
//       expanded or which tab is open — main.js never gated it on expansion.
//   (b) REAL: on a helper failure pollMedia did `if (!r.ok) return;` —
//       silently leaving mediaState stale/empty with no error surfaced
//       anywhere. Now mediaState.error is set on failure, cleared on success.
//   (c) REAL: media.ps1 skipped every session with no title
//       (`if (... IsNullOrWhiteSpace($props.Title)) { continue }`). Chrome's
//       session is briefly title-less on track transitions (and is deleted
//       ~0.8-1s after a skip), so YouTube in Chrome vanished exactly when
//       PJ skipped/changed tracks. media.ps1 now keeps a session that has
//       an AUMID even with an empty title (the app name is shown instead).
//   (d) REAL (partial): media-control.ps1 fell back to GetCurrentSession()
//       whenever no session id was passed — and the dock's now-playing
//       toggle (dock.html) and the Deck /api/media endpoint both call
//       mediaCommand with NO id, so they could control the wrong app.
//       Now main resolves a missing id to the ACTIVE session's id, and
//       media-control.ps1 refuses to run without a session id at all.
//   (e) REAL: a session that disappeared for one poll was dropped at once.
//       Now a vanished session is kept for a ~1.5s grace period.
//   (f) NEW: 'seek' — mediaCommand(cmd, sessionId, value) with cmd 'seek'
//       seeks via TryChangePlaybackPositionAsync in media-control.ps1.
async function pollMedia() {
  if (!IS_WIN || process.env.OI_MOCK_MEDIA) return; // mock hook owns the state on Linux
  if (mediaPollInFlight) return; // skip the tick — never overlap two media.ps1 runs
  mediaPollInFlight = true;
  try {
  const r = await psJson('media.ps1');
  if (!r.ok) {
    // (b) surface the failure instead of silently leaving stale/empty state.
    mediaState = { ...mediaState, error: r.error || 'media helper failed' };
    islandWin?.webContents.send('media-updated', mediaState);
    return;
  }
  // v1.0.2: media.ps1 reports real errors now (outer failure -> error
  // payload; per-session failures -> skipped count). Surface both: the
  // error becomes mediaState.error (the renderer shows "Media
  // unavailable", never a fake "No media playing"), and a skipped count
  // is logged (throttled) so a session that throws inside
  // TryGetMediaProperties is visible in openisland.log. The empty state
  // stays honest: only a successful check with zero sessions shows
  // "No media playing".
  // Media stays on the per-call spawn path on purpose (v1.0.2 note): the
  // persistent foreground process has ONE pending slot, and a media read
  // (WinRT + artwork, up to ~1 s) would make foreground ticks fail "busy"
  // ~15% of the time and flicker the island over Chrome. A media spawn
  // costs ~2 s on a slow machine but runs concurrently and never blocks
  // the foreground poll; pollMedia is serialised (skip-if-in-flight).
  if (r.data.error) {
    mediaState = { ...mediaState, error: String(r.data.error).slice(0, 200) };
    logHelperFailure('media.ps1', r.data.error);
    islandWin?.webContents.send('media-updated', mediaState);
    return;
  }
  if (r.data.skipped > 0) logHelperFailure('media.ps1', `${r.data.skipped} media session(s) skipped (failed to read properties)`);
  const now = Date.now();
  const fresh = (r.data.sessions || []).map(s => ({
    id: s.id || ('title:' + (s.title || '')),
    app: s.app || 'Unknown app',
    title: s.title || '', artist: s.artist || '', album: s.album || '',
    status: (s.status || '').toLowerCase().includes('play') ? 'playing' : 'paused',
    position: s.position || 0, duration: s.duration || 0,
    artwork: s.artwork || '',
  }));
  for (const s of fresh) mediaLastSeen.set(s.id, now);
  // (e) grace period: keep sessions seen within the last 1.5s even if this
  // poll missed them (Chrome session churn on skip / track change).
  let sessions = [...fresh];
  for (const prev of mediaState.sessions) {
    if (sessions.some(x => x.id === prev.id)) continue;
    const lastSeen = mediaLastSeen.get(prev.id) || 0;
    if (now - lastSeen <= MEDIA_GRACE_MS) sessions.push(prev);
    else mediaLastSeen.delete(prev.id);
  }
  const prevActive = mediaState.sessions[mediaState.activeIndex];
  let activeIndex = 0;
  if (prevActive) { const i = sessions.findIndex(x => x.id === prevActive.id); if (i >= 0) activeIndex = i; }
  if (sessions.length && sessions[activeIndex].status !== 'playing') {
    const p = sessions.findIndex(x => x.status === 'playing');
    if (p >= 0) activeIndex = p; // prefer a playing session when the old active one stopped
  }
  mediaState = { source: sessions.length ? 'smtc' : 'none', sessions, activeIndex, error: null };
  islandWin?.webContents.send('media-updated', mediaState);
  maybeShowNowPlayingChip();
  } finally { mediaPollInFlight = false; }
}
// v1.0.0 (§7): transient now-playing chip above the taskbar — "Title –
// Artist", shown briefly when the track CHANGES while the island taskbar is
// on, then hidden after 3 s. A track change is a new session id/title; the
// same track never re-triggers it.
let chipWin = null, chipTimer = null, lastChipTrackId = '';
function maybeShowNowPlayingChip() {
  const s = mediaState.sessions[mediaState.activeIndex];
  if (!s || !s.title || s.status !== 'playing') return;
  const key = s.id + '|' + s.title;
  if (key === lastChipTrackId) return;
  lastChipTrackId = key;
  showNowPlayingChip(s);
}
function showNowPlayingChip(session) {
  if (!dockWin || dockWin.isDestroyed() || !dockWin.isVisible()) return;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const w = 340, h = 44;
  if (!chipWin || chipWin.isDestroyed()) {
    chipWin = new BrowserWindow({
      width: w, height: h, x: Math.round((sw - w) / 2), y: sh - 68 - 52,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
      resizable: false, focusable: false, hasShadow: false, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
    });
    chipWin.setMenu(null);
    chipWin.loadFile(path.join(__dirname, 'renderer', 'chip.html'));
    chipWin.setIgnoreMouseEvents(true, { forward: true });
    chipWin.on('closed', () => { chipWin = null; });
  }
  const send = () => chipWin?.webContents.send('chip-show', { title: session.title, artist: session.artist || '' });
  if (chipWin.webContents.isLoading()) chipWin.webContents.once('did-finish-load', send); else send();
  chipWin.show();
  if (chipTimer) clearTimeout(chipTimer);
  chipTimer = setTimeout(() => { if (chipWin && !chipWin.isDestroyed()) chipWin.hide(); }, 3000);
  if (chipTimer.unref) chipTimer.unref();
}
async function mediaCommand(cmd, sessionId, value) {
  if (!IS_WIN) return { ok: false, error: 'System media control is Windows-only; use the in-app player.' };
  if (cmd === 'seek') {
    // (f) seek <sessionId> <seconds> — per-session only, via
    // TryChangePlaybackPositionAsync; value must be a finite number.
    const seconds = Number(value);
    if (!sessionId) return { ok: false, error: 'seek needs a media session id' };
    if (sessionId === 'inapp') return { ok: false, error: 'The in-app player does not support seeking.' };
    if (!Number.isFinite(seconds) || seconds < 0) return { ok: false, error: 'seek needs a position in seconds (>= 0)' };
    return runPs('media-control.ps1', ['seek', sessionId, String(seconds)]);
  }
  if (sessionId === 'inapp') return { ok: false, error: 'The in-app player has no next/previous — it plays one file.' };
  // (d) never fall back to GetCurrentSession(): a missing id resolves to the
  // ACTIVE session's id, and with no active session the command is refused
  // rather than silently controlling whatever Windows thinks is current.
  const id = sessionId || mediaState.sessions[mediaState.activeIndex]?.id;
  if (!id) return { ok: false, error: 'No media session to control.' };
  return runPs('media-control.ps1', [cmd, id]);
}

// ---------- Clipboard ----------
function clipTick() {
  try {
    const t = clipboard.readText();
    if (t && t !== lastClipText) {
      lastClipText = t;
      if (settings.panels.clipboard) {
        const isPasswordManager = /password|1password|bitwarden|keepass/i.test(app.getPath('exe')); // placeholder guard: see README
        const item = { id: Date.now(), kind: /^https?:\/\//.test(t.trim()) ? 'link' : 'text', text: t.slice(0, 5000), pinned: false, ts: Date.now() };
        clipHistory = [item, ...clipHistory.filter(x => x.text !== t)].slice(0, 100);
        saveClipHistory();
        islandWin?.webContents.send('clipboard-updated', clipHistory);
      }
    }
  } catch { /* clipboard busy */ }
}
function saveClipHistory() {
  // Encrypted for the Windows account via safeStorage when available (Windows).
  try {
    if (IS_WIN && safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(CLIP_PATH + '.enc', safeStorage.encryptString(JSON.stringify(clipHistory)));
      if (fs.existsSync(CLIP_PATH)) fs.unlinkSync(CLIP_PATH);
      return;
    }
  } catch { /* fall through to plain JSON on Linux dev box */ }
  saveJson(CLIP_PATH, clipHistory);
}
function loadClipHistory() {
  try {
    if (IS_WIN && fs.existsSync(CLIP_PATH + '.enc') && safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(CLIP_PATH + '.enc')));
    }
  } catch { /* fall through */ }
  return loadJson(CLIP_PATH, []);
}

// ---------- Windows ----------
function islandBounds(collapsed) {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const w = collapsed ? settings.island.width : settings.island.expandedWidth;
  const h = collapsed ? 35 : settings.island.expandedHeight; // v1.0.0: pill is 206x35 @1920 (was 170x34)
  let x = Math.round((sw - w) / 2);
  if (stepAsideActive || settings.island.position === 'top-right') x = sw - w - 16;
  else if (settings.island.position === 'top-left') x = 16;
  const y = settings.island.shape === 'notch' ? 0 : 8;
  return { x, y, width: w, height: h };
}
function createIsland() {
  const b = islandBounds(true);
  islandWin = new BrowserWindow({
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    ...b, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: true, hasShadow: false, type: 'toolbar', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  islandWin.setMenu(null); // item 16: no menu bar on any window
  islandWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  applyClickThrough();
  islandWin.on('closed', () => { islandWin = null; });
}
function setIslandCollapsed(collapsed) {
  if (!islandWin) return;
  // Dev/test hook only: OI_DEBUG_COLLAPSE=1 logs every collapse with its
  // caller, so a phantom collapse (rig flake in v5 verification) can be
  // traced to the poll, the renderer IPC, or a per-app step-aside rule.
  if (collapsed && process.env.OI_DEBUG_COLLAPSE) console.log('[collapse] from', new Error().stack.split('\n').slice(2, 6).join(' | '));
  islandCollapsed = collapsed;
  // v5.0.2 (item 1): every expand starts with the pointer NOT yet entered —
  // the poll must see the pointer inside once before it may collapse.
  pointerEnteredSinceExpand = false;
  if (!collapsed) expandAt = Date.now();
  if (collapsed) {
    // Every collapse arms the anti-flicker guards: hover can't re-expand for
    // 600ms, and the pointer must leave the pill once first — so clicking ✕
    // (or the hotkey) while hovering doesn't instantly reopen the island.
    expandCooldownUntil = Date.now() + 600;
    needLeaveBeforeHover = true;
  }
  const b = islandBounds(collapsed);
  islandWin.setBounds(b);
  applyClickThrough();
  islandWin.webContents.send('island-state', { collapsed });
  startCursorPoll(); // one poll, two jobs — it branches on islandCollapsed
}
// Pointer position for the cursor poll.
// Linux/Xvfb quirk (verified 2026-11-13 with three minimal Electron apps):
// screen.getCursorScreenPoint() returns the pointer position as of app start
// and never updates on this Linux box — a windowless app stayed frozen at its
// startup position across real xdotool moves. On Windows it is a live
// Win32 GetCursorPos call, so the poll uses it there. OI_POINTER_FILE exists
// so the poll's state machine (dwell, collapse, leave-guard) can still be
// tested headlessly: the poll reads {"x":N,"y":N} from that file each tick.
function getPointerPos() {
  if (process.env.OI_POINTER_FILE) {
    try {
      const j = JSON.parse(fs.readFileSync(process.env.OI_POINTER_FILE, 'utf8'));
      if (typeof j.x === 'number' && typeof j.y === 'number') return j;
    } catch { /* fall through to the live API */ }
  }
  return screen.getCursorScreenPoint();
}
// auto-expand. Renderer :hover can't be trusted for either on a transparent
// frameless window — with click-through on, the page may never see mousemove
// at all (verified under xvfb: elementFromPoint hits the pill but :hover is
// false). So the main process watches the real cursor:
//   expanded  → pointer entered the island once since this expand, then
//               moved outside (+8px margin), after a 500 ms grace = collapse
//               (v5.0.2: a click-open with the pointer far away never
//               collapses on the first tick — it never entered at all)
//   collapsed → pointer resting on the pill for openDelayMs = expand
// After a poll-driven collapse the pointer must LEAVE the pill once before a
// hover can re-expand it, so the island can't flicker while the mouse sits still.
function startCursorPoll() {
  stopCursorPoll();
  cursorPoll = setInterval(() => {
    if (!islandWin) return stopCursorPoll();
    try {
      const p = getPointerPos();
      const b = islandWin.getBounds();
      const m = 8; // small margin so a 1px wobble at the edge doesn't collapse it
      if (process.env.OI_DEBUG_POLL) console.log('[poll]', JSON.stringify({ collapsed: islandCollapsed, p, b, needLeave: needLeaveBeforeHover, hoverSince, cooldownUntil: expandCooldownUntil, entered: pointerEnteredSinceExpand }));
      if (islandCollapsed) {
        const inside = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
        // The leave MUST be observed before the hold-Ctrl guard below: in
        // hold-Ctrl mode the guard returns early while Ctrl is up, so if the
        // leave-check sat after it, a leave that happened with Ctrl up would
        // never clear needLeaveBeforeHover — and holding Ctrl while already
        // hovering the pill could then never expand it (caught under xvfb).
        if (needLeaveBeforeHover) { if (!inside) needLeaveBeforeHover = false; hoverSince = 0; return; }
        // hold-ctrl mode (manual setting OR a fullscreen app in front,
        // item F): hover must NOT expand without Ctrl held — the click must
        // land on the app underneath, no hover exceptions.
        if (effectiveHoldCtrl() && !ctrlHeld) { hoverSince = 0; return; }
        if (!inside) { hoverSince = 0; return; }
        if (Date.now() < expandCooldownUntil) { hoverSince = 0; return; }
        if (!hoverSince) hoverSince = Date.now();
        if (Date.now() - hoverSince >= (settings.island.openDelayMs ?? 350)) {
          hoverSince = 0;
          setIslandCollapsed(false);
        }
      } else {
        hoverSince = 0;
        // v5.0.2 (item 1): collapse only after the pointer entered the island
        // at least once since this expand (plus a 500 ms grace) — a
        // tray/hotkey/"Show island" expand with the pointer far away must
        // NOT collapse on the first tick.
        const inside = p.x >= b.x - m && p.x <= b.x + b.width + m && p.y >= b.y - m && p.y <= b.y + b.height + m;
        if (inside) pointerEnteredSinceExpand = true;
        if (pointerEnteredSinceExpand && Date.now() - expandAt >= 500 && !inside) {
          setIslandCollapsed(true); // guards are armed inside setIslandCollapsed
        }
      }
    } catch { /* screen unavailable — renderer mouseleave is the fallback */ }
  }, 150);
  if (cursorPoll.unref) cursorPoll.unref();
}
function stopCursorPoll() { if (cursorPoll) { clearInterval(cursorPoll); cursorPoll = null; } }
function createSettingsWindow() {
  if (settingsWin) { if (!settingsWin.isVisible()) settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 780, height: 680, minWidth: 760, minHeight: 600, title: 'OpenIsland Settings', show: false, // v1.0.0: ~780px wide, like the reference Settings window (r-039)
    icon: path.join(__dirname, '..', 'assets', 'icon.png'), autoHideMenuBar: true,
    transparent: true, // Glass surface (image-33): with a Glass theme the settings window itself is see-through glass; a normal surface renders it dark/opaque
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  settingsWin.setMenu(null); // item 16: no menu bar — this also kills the File > Exit trap (item 14)
  // Item 14 (isQuitting pattern): closing Settings only hides it — the app
  // keeps running in the tray/island. Only the tray "Quit OpenIsland"
  // (which sets isQuitting) may actually quit.
  settingsWin.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); settingsWin.hide(); }
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}
// v1.0.0: open Settings at a section (profile icon → About, favourite-apps
// setup → Keys). The section message is sent after the window loads —
// sending before did-finish-load would be dropped.
function openSettingsSection(section) {
  createSettingsWindow();
  if (!section || !settingsWin) return;
  const send = () => settingsWin?.webContents.send('open-settings-section', section);
  if (settingsWin.webContents.isLoading()) settingsWin.webContents.once('did-finish-load', send);
  else send();
}
function createGameStrip() {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const w = 340;
  const x = settings.gaming.stripPosition === 'top-right' ? sw - w - 16 : 16;
  if (gameStripWin) { gameStripWin.setBounds({ x, y: 8, width: w, height: 26 }); gameStripWin.show(); return; }
  gameStripWin = new BrowserWindow({
    width: w, height: 26, x, y: 8, frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, focusable: false, hasShadow: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  gameStripWin.setMenu(null); // item 16
  gameStripWin.loadFile(path.join(__dirname, 'renderer', 'gamestrip.html'));
  // Item 22: the strip MUST receive mouse events — its right-click menu is
  // the discoverable way to hide it. focusable:false keeps it from stealing
  // keyboard focus from the game; the cost is a 340x26 strip area that does
  // not click through to the game underneath.
  gameStripWin.setIgnoreMouseEvents(false);
  gameStripWin.on('closed', () => { gameStripWin = null; });
}
function createDesktopWidget(kind) {
  if (widgetWins[kind]) { widgetWins[kind].focus(); return; }
  const sizes = { clock: [300, 150], weather: [280, 140], stats: [280, 120] };
  // v1.0.0 (§12): desktop widgets restore in a fixed non-overlapping grid
  // at the top-left — clock top-left, weather below it, stats to the right
  // of the clock — never the old 40px cascade that stacked them on top of
  // each other. The user can still drag any widget anywhere afterwards.
  const gridPos = { clock: [16, 16], weather: [16, 182], stats: [332, 16] };
  const [gx, gy] = gridPos[kind] || [16, 16];
  const [w, h] = sizes[kind] || [280, 140];
  const win = new BrowserWindow({
    width: w, height: h, frame: false, transparent: true, alwaysOnTop: false, skipTaskbar: true,
    resizable: true, hasShadow: false, x: gx, y: gy, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setMenu(null); // item 16
  win.loadFile(path.join(__dirname, 'renderer', 'widget.html'), { query: { kind } });
  win.on('closed', () => { delete widgetWins[kind]; });
  widgetWins[kind] = win;
}
// Item 24(b): restore desktop widgets at startup and keep them in sync with
// settings — a widget whose desktop* flag is on gets a window, one turned
// off gets its window closed. Called at startup and on every settings apply.
function syncDesktopWidgets() {
  const map = { clock: settings.widgets.desktopClock, weather: settings.widgets.desktopWeather, stats: settings.widgets.desktopStats };
  for (const [kind, on] of Object.entries(map)) {
    if (on) createDesktopWidget(kind);
    else if (widgetWins[kind] && !widgetWins[kind].isDestroyed()) widgetWins[kind].close();
  }
}
// v1.0.0 (§11): the first-run tour is a separate modal dialog (tour.html),
// not a banner in the island. Own window, dark, centred, title bar + X,
// "Start with Windows?" step with a toggle, Back / Next (white-filled).
// The island itself stays collapsed until hovered/clicked.
function createTourWindow() {
  if (tourWin && !tourWin.isDestroyed()) { tourWin.focus(); return; }
  tourWin = new BrowserWindow({
    width: 460, height: 360, frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, center: true, show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  tourWin.setMenu(null);
  tourWin.loadFile(path.join(__dirname, 'renderer', 'tour.html'));
  tourWin.once('ready-to-show', () => tourWin.show());
  tourWin.on('closed', () => { tourWin = null; });
}
function showReminderPopup(rem) {
  if (reminderWin) reminderWin.close();
  reminderWin = new BrowserWindow({
    width: 420, height: 150, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: false, center: true, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  reminderWin.setMenu(null); // item 16
  reminderWin.loadFile(path.join(__dirname, 'renderer', 'reminder.html'), { query: { id: String(rem.id), text: encodeURIComponent(rem.text) } });
  reminderWin.on('closed', () => { reminderWin = null; });
}
function scheduleReminder(rem) {
  const delay = Math.max(0, rem.at - Date.now());
  rem._timer = setTimeout(() => {
    showReminderPopup(rem);
    reminders = reminders.filter(r => r.id !== rem.id);
    saveJson(REMINDERS_PATH, reminders);
    islandWin?.webContents.send('reminders-updated', reminders);
  }, delay);
  if (rem._timer.unref) rem._timer.unref();
}

// ---------- Tray ----------
function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show island', click: () => { if (!canShowIsland()) return; setIslandCollapsed(false); islandWin?.show(); } },
    { label: 'Settings', click: createSettingsWindow },
    { label: 'Game strip: ' + (settings.gaming.showStrip === false ? 'Off' : 'On'), click: () => { settings.gaming.showStrip = settings.gaming.showStrip === false; saveSettings(); applyGameStrip(); } },
    { type: 'separator' },
    { label: 'Quit OpenIsland', click: () => { isQuitting = true; if (tray) { try { tray.destroy(); } catch { /* already gone */ } tray = null; } app.quit(); } },
  ]));
}
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('OpenIsland — free Dynamic Island');
  refreshTrayMenu();
  tray.on('click', () => { setIslandCollapsed(false); islandWin?.show(); });
}
function applyGameStrip() {
  // BUG 3 (v2.0.0): OFF means the strip window is destroyed, not hidden —
  // a hidden window still exists and can come back on the next apply.
  if (settings.gaming.mode === 'strip' && settings.gaming.showStrip !== false) createGameStrip();
  else if (gameStripWin) { const w = gameStripWin; gameStripWin = null; w.close(); }
  refreshTrayMenu();
}
// Item 22: strip right-click menu — "Hide strip" destroys the strip window
// entirely (gaming.showStrip=false + applyGameStrip) and saves settings;
// "Strip settings" opens Settings (Gaming section; settings.html listens for
// 'open-settings-section' — if it does not, Settings still opens). Module
// scope (with the last-built menu retained) so the OI_TEST_STRIP_MENU hook
// can drive it headlessly.
let stripContextMenu = null;
function showStripContextMenu() {
  stripContextMenu = Menu.buildFromTemplate([
    {
      label: 'Hide strip', click: () => {
        settings.gaming.showStrip = false; saveSettings();
        applyGameStrip(); pushSettingsToIsland();
      },
    },
    {
      label: 'Strip settings', click: () => {
        createSettingsWindow();
        settingsWin?.webContents.send('open-settings-section', 'gaming');
      },
    },
  ]);
  stripContextMenu.popup();
}

// ---------- Transient pop-ups (volume / brightness / battery / headphones) ----------
// A small glass pill at the top centre, auto-dismissing after ~2.5s — the
// same language as the island, not a Windows toast.
let popupWin = null, popupTimer = null;
function showPopup({ icon, text, sub }) {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const w = 340, h = 64;
  if (!popupWin || popupWin.isDestroyed()) {
    popupWin = new BrowserWindow({
      width: w, height: h, x: Math.round((sw - w) / 2), y: 54,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
      resizable: false, focusable: false, hasShadow: false, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
    });
    popupWin.setMenu(null); // item 16
    popupWin.loadFile(path.join(__dirname, 'renderer', 'popup.html'));
    popupWin.setIgnoreMouseEvents(true, { forward: true });
    popupWin.on('closed', () => { popupWin = null; });
  }
  const send = () => popupWin?.webContents.send('popup-show', { icon, text, sub: sub || '' });
  if (popupWin.webContents.isLoading()) popupWin.webContents.once('did-finish-load', send); else send();
  popupWin.show();
  if (popupTimer) clearTimeout(popupTimer);
  popupTimer = setTimeout(() => { try { popupWin?.close(); } catch { /* already closed */ } }, 2600);
  if (popupTimer.unref) popupTimer.unref();
}
// Power + audio-endpoint watchers (Windows): battery/AC/saver changes and
// headphone connect/disconnect fire pop-ups. Cheap polls, Windows only.
let lastAudioNames = null;
async function pollPowerAndAudio() {
  if (!IS_WIN) return;
  const p = await psJson('power.ps1');
  if (p.ok && p.data) {
    const cur = { acOnline: !!p.data.acOnline, saverOn: !!p.data.saverOn, batteryPct: p.data.batteryPct };
    if (lastPowerState) {
      if (cur.acOnline !== lastPowerState.acOnline) showPopup({ icon: 'battery', text: cur.acOnline ? 'Charger connected' : 'On battery power', sub: cur.batteryPct != null ? cur.batteryPct + '% remaining' : '' });
      else if (cur.saverOn !== lastPowerState.saverOn && cur.saverOn) showPopup({ icon: 'battery', text: 'Battery saver on', sub: 'Live wallpaper and animations pause' });
    }
    lastPowerState = cur;
  }
  const a = await psJson('audio-devices.ps1');
  if (a.ok && a.data) {
    const names = (a.data.devices || []).map(d => d.name);
    if (lastAudioNames) {
      const added = names.filter(n => !lastAudioNames.includes(n));
      const removed = lastAudioNames.filter(n => !names.includes(n));
      if (added.length) showPopup({ icon: 'headphones', text: 'Headphones connected', sub: added[0] });
      else if (removed.length) showPopup({ icon: 'headphones', text: 'Headphones disconnected', sub: removed[0] });
    }
    lastAudioNames = names;
  }
}

// ---------- Live wallpaper (opt-in, off by default) ----------
// The video window is reparented behind the
// desktop icons (Progman -> WorkerW) via wallpaper-attach.ps1. The window
// hosts a <video> element; the page caps the presented frame rate with a
// canvas and scales the backing store by the quality setting.
function liveWallpaperFileOk() {
  const f = settings.liveWallpaper.file || '';
  return f && fs.existsSync(f);
}
function createWallpaperWindow() {
  if (wallpaperWin && !wallpaperWin.isDestroyed()) return wallpaperWin;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().size;
  const testSize = !IS_WIN; // Linux dev box: a small visible window so the page logic is testable
  wallpaperWin = new BrowserWindow({
    width: testSize ? 640 : sw, height: testSize ? 360 : sh,
    x: testSize ? 40 : 0, y: testSize ? 40 : 0,
    frame: false, transparent: false, backgroundColor: '#000',
    skipTaskbar: true, focusable: false, alwaysOnTop: false,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  wallpaperWin.setMenu(null); // item 16
  const q = { file: settings.liveWallpaper.file, quality: settings.liveWallpaper.quality, fps: String(settings.liveWallpaper.fps) };
  wallpaperWin.loadFile(path.join(__dirname, 'renderer', 'wallpaper.html'), { query: q });
  wallpaperWin.on('closed', () => { wallpaperWin = null; wallpaperAttached = false; });
  return wallpaperWin;
}
async function attachWallpaper() {
  if (!wallpaperWin || wallpaperWin.isDestroyed() || !IS_WIN) return;
  const handle = wallpaperWin.getNativeWindowHandle();
  const hwnd = Number(handle.readBigInt64LE(0));
  const r = await psJson('wallpaper-attach.ps1', [String(hwnd)]);
  if (r.ok) { wallpaperAttached = true; wallpaperAttachFails = 0; }
  else { wallpaperAttached = false; wallpaperAttachFails++; }
}
async function applyLiveWallpaper() {
  const lw = settings.liveWallpaper;
  if (!lw.enabled || !liveWallpaperFileOk()) {
    if (lw.enabled && !liveWallpaperFileOk()) {
      settings.liveWallpaper.enabled = false; saveSettings();
      addAppNotification('Live wallpaper turned off — the video file is missing.', 'wallpaper');
    }
    if (wallpaperWin && !wallpaperWin.isDestroyed()) wallpaperWin.close();
    wallpaperWin = null; wallpaperAttached = false;
    return;
  }
  const win = createWallpaperWindow();
  win.webContents.send('wallpaper-settings', { file: lw.file, quality: lw.quality, fps: lw.fps });
  if (!win.isVisible()) win.show();
  if (IS_WIN && !wallpaperAttached) await attachWallpaper();
  evaluateWallpaperPause();
}
async function evaluateWallpaperPause() {
  if (!wallpaperWin || wallpaperWin.isDestroyed() || !settings.liveWallpaper.enabled) return;
  const lw = settings.liveWallpaper;
  let shouldPause = false;
  if (lw.pauseOnFullscreen && foregroundState?.isFullscreen) shouldPause = true;
  if ((lw.pauseOnBattery || lw.pauseOnSaver) && lastPowerState) {
    if (lw.pauseOnBattery && !lastPowerState.acOnline) shouldPause = true;
    if (lw.pauseOnSaver && lastPowerState.saverOn) shouldPause = true;
  }
  if (shouldPause !== wallpaperPaused) {
    wallpaperPaused = shouldPause;
    wallpaperWin.webContents.send(shouldPause ? 'wallpaper-pause' : 'wallpaper-play');
  }
}
// Watchdog: Explorer restarts destroy the WorkerW — re-attach, and give up
// (disable + tell the user) after repeated failures instead of looping.
setInterval(async () => {
  if (!settings.liveWallpaper.enabled || !wallpaperWin || wallpaperWin.isDestroyed()) return;
  if (IS_WIN && !wallpaperAttached) {
    await attachWallpaper();
    if (wallpaperAttachFails >= 3) {
      settings.liveWallpaper.enabled = false; saveSettings();
      addAppNotification('Live wallpaper disabled — the desktop layer could not be attached.', 'wallpaper');
      applyLiveWallpaper();
    }
  }
}, 5000).unref?.();

// ---------- Windows taskbar hide / work-area reservation ----------
// Item 9: ONE toggle does it all — settings.taskbar.enabled=true alone hides
// the Windows taskbar (no two-step: enable here + hide there). The hide is a
// direct Win32 ShowWindow(SW_HIDE) on Shell_TrayWnd (+ Shell_SecondaryTrayWnd
// per monitor) in taskbar.ps1 — NO StuckRects3 registry write, NO Explorer
// kill, NO Winlogon Shell key, NO auto-hide registry touch. Hiding also
// reclaims the space: the work area is set to full height (minus the dock's
// own 80px reserve while our dock is on). Restored on toggle-off AND on
// will-quit/before-quit, and a 5s watchdog re-asserts hidden while enabled
// (Explorer restarts recreate the taskbar visible).
let windowsTaskbarHidden = false;
let workAreaReserved = false;
let taskbarWatchdog = null;
let taskbarReasserting = false;
// v5.0.0 (item D1): last VERIFIED result from taskbar.ps1 — the Settings
// Taskbar section reads it via 'taskbar-status', so the state is visible
// instead of guessed. verifiedAt is a timestamp (ms), or null when the
// helper has never run or failed. Announce dedupe: a failed hide toasts
// once per toggle, not on every settings save while it stays failed.
let taskbarLastResult = { ok: false, hidden: null, verifiedAt: null };
let lastTaskbarAnnounceKey = null;
async function setWindowsTaskbarHidden(wantHidden, { announce = false } = {}) {
  const r = await psJson('taskbar.ps1', [wantHidden ? 'hide' : 'show']);
  const key = (wantHidden ? 'hide' : 'show') + ':' + (r.ok && r.data && r.data.hidden === wantHidden ? 'ok' : 'fail');
  if (!r.ok) {
    taskbarLastResult = { ok: false, hidden: windowsTaskbarHidden, verifiedAt: null };
    logLine(`taskbar: helper failed while trying to ${wantHidden ? 'hide' : 'show'} the Windows taskbar`);
    if (announce && key !== lastTaskbarAnnounceKey) {
      lastTaskbarAnnounceKey = key;
      showPopup({ icon: 'alert', text: wantHidden ? "Couldn't hide the Windows taskbar" : "Couldn't show the Windows taskbar", sub: '' });
    }
    return false;
  }
  const verifiedHidden = r.data.hidden === true;
  taskbarLastResult = { ok: true, hidden: verifiedHidden, verifiedAt: Date.now() };
  windowsTaskbarHidden = verifiedHidden;
  if (verifiedHidden !== wantHidden) {
    logLine(`taskbar: ${wantHidden ? 'hide' : 'show'} did NOT stick — Windows taskbar is still ${verifiedHidden ? 'hidden' : 'visible'} (verified after the call)`);
    if (announce && key !== lastTaskbarAnnounceKey) {
      lastTaskbarAnnounceKey = key;
      showPopup({ icon: 'alert', text: wantHidden ? "Couldn't hide the Windows taskbar" : "Couldn't show the Windows taskbar", sub: '' });
    }
    return false;
  }
  logLine(`taskbar: Windows taskbar ${wantHidden ? 'hidden' : 'shown'} (verified)`);
  if (announce && key !== lastTaskbarAnnounceKey) {
    lastTaskbarAnnounceKey = key;
    showPopup({ icon: 'check', text: wantHidden ? 'Windows taskbar hidden' : 'Windows taskbar shown', sub: '' });
  }
  return true;
}
// v5.0.1 (item 3): the safety invariant as a predicate — the Windows taskbar
// may be hidden only while the user still has a replacement on screen (the
// island, the dock, or both). Used by applyTaskbarWindows, the reassert
// watchdog and the startup safety watchdog.
function hasTaskbarReplacement() {
  const islandVisible = !!(islandWin && !islandWin.isDestroyed() && islandWin.isVisible());
  const dockVisible = !!(dockWin && !dockWin.isDestroyed() && dockWin.isVisible());
  return islandVisible || dockVisible;
}
// v1.0.0 (item D, PJ 2026-11-14): one definition of "the Windows taskbar
// is supposed to be hidden" — the Windows taskbar hides IF AND ONLY IF the
// island taskbar is enabled. Hide-on-its-own is gone (it SUPERSEDES the
// v5.0.3 item-4 rule, where enabled || hideWindowsTaskbar || autoHideOnSide
// hid it): with enabled=false the Windows taskbar NEVER hides, whatever is
// stored. Used by applyTaskbarWindows and the reassert watchdog so they
// can never disagree. This also simplifies the safety invariant — with
// nothing hiding, no replacement is needed.
function taskbarWantHidden() {
  return !!settings.taskbar.enabled;
}
async function applyTaskbarWindows() {
  if (!IS_WIN) return;
  // enabled alone decides — hideWindowsTaskbar / autoHideOnSide are gone (v6 item D).
  const wantHidden = taskbarWantHidden();
  // v5.0.1 (item 3): "created" is not "visible" — never hide the Windows
  // taskbar until a replacement (island or dock) is confirmed on screen.
  // If the guard blocks, the taskbar simply stays (safe) and the 5 s
  // reassert watchdog retries the hide once a replacement is visible.
  const guardedHidden = wantHidden && hasTaskbarReplacement();
  if (wantHidden && !guardedHidden) logLine('taskbar: NOT hiding Windows taskbar — neither the island nor the dock is visible yet (safety invariant)');
  const hiddenChanged = guardedHidden !== windowsTaskbarHidden;
  if (hiddenChanged) {
    await setWindowsTaskbarHidden(guardedHidden, { announce: true });
  }
  // When our dock is on, maximised windows must stop above it (work area).
  // Re-apply on a hide/show change too: hiding the taskbar changes the work
  // area underneath, so a reserve computed against the old area would be
  // short by the taskbar's height. workarea 'restore' is taskbar-aware (it
  // subtracts the visible taskbar's height), then 'set 80' reserves the dock.
  const wantReserve = settings.taskbar.enabled;
  if (wantReserve !== workAreaReserved || (hiddenChanged && wantReserve)) {
    workAreaReserved = wantReserve;
    if (wantReserve) {
      await runPs('workarea.ps1', ['restore']);
      await runPs('workarea.ps1', ['set', '80']);
    } else await runPs('workarea.ps1', ['restore']);
  }
  // v1.0.0 (item D): the reassert runs only while the island taskbar is
  // enabled — hide-on-its-own is gone, so there is nothing to re-hide
  // when enabled is false.
  if (wantHidden && !taskbarWatchdog) {
    taskbarWatchdog = setInterval(reassertTaskbarWindows, 5000);
    if (taskbarWatchdog.unref) taskbarWatchdog.unref();
  } else if (!wantHidden && taskbarWatchdog) {
    clearInterval(taskbarWatchdog); taskbarWatchdog = null;
  }
}
// 5s watchdog: Explorer restarts recreate the taskbar visible — re-hide it
// and re-assert the work area while the island taskbar is enabled
// (v1.0.0 item D: enabled only). v5.0.0: check the
// real visibility first ('status' — no change), only hide when it is
// actually visible again, and log failures (never toast from the watchdog).
async function reassertTaskbarWindows() {
  if (!IS_WIN || !taskbarWantHidden() || taskbarReasserting) return;
  taskbarReasserting = true;
  try {
    const st = await psJson('taskbar.ps1', ['status']);
    if (st.ok && st.data && st.data.hidden === true) {
      taskbarLastResult = { ok: true, hidden: true, verifiedAt: Date.now() };
      windowsTaskbarHidden = true;
    } else {
      if (!st.ok) logLine('taskbar: watchdog could not check the Windows taskbar');
      // v5.0.1 (item 3): the reassert hide obeys the same invariant — never
      // re-hide while no replacement is on screen.
      if (!hasTaskbarReplacement()) logLine('taskbar: watchdog NOT re-hiding — neither the island nor the dock is visible (safety invariant)');
      else await setWindowsTaskbarHidden(true, { announce: false });
    }
    if (workAreaReserved) {
      await runPs('workarea.ps1', ['restore']);
      await runPs('workarea.ps1', ['set', '80']);
    }
  } catch { /* next tick retries */ } finally { taskbarReasserting = false; }
}
// Synchronous restore for quit paths: app.quit() does not wait for async
// PowerShell calls, so will-quit/before-quit restore via spawnSync instead.
const { spawnSync } = require('child_process');
function restoreTaskbarSync() {
  if (!IS_WIN) return;
  try {
    // Item G: quit-time restore must use the UNPACKED helper paths too —
    // the asar path can never run under PowerShell, so the Windows taskbar
    // would never come back on quit.
    const script = helperPath('taskbar.ps1');
    if (windowsTaskbarHidden && fs.existsSync(script)) spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, 'show'], { timeout: 5000, windowsHide: true });
    const wa = helperPath('workarea.ps1');
    if (workAreaReserved && fs.existsSync(wa)) spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wa, 'restore'], { timeout: 5000, windowsHide: true });
  } catch { /* best-effort restore on the way out */ }
  windowsTaskbarHidden = false; workAreaReserved = false;
}

// ---------- Glass capture behaviour (image-33 note) ----------
// While a Glass surface (Liquid Glass / Candy Glass) is active the island is
// excluded from screen capture (WDA_EXCLUDEFROMCAPTURE) — Glass reads the
// screen behind it, so Windows keeps it out of every screenshot/recording.
// When OBS is recording or streaming, the island falls back to plain glass
// (affinity removed + the renderer's obs-live class) so it shows in the video.
// The OBS fallback only works when the OBS WebSocket is enabled in Settings.
let glassAffinityOn = false;
async function applyGlassAffinity() {
  if (!IS_WIN || !islandWin) return;
  const isGlass = settings.appearance.theme === 'liquid-glass' || settings.appearance.theme === 'candy-glass';
  const obsLive = obsState.recording || obsState.streaming;
  const want = isGlass && !obsLive;
  if (want === glassAffinityOn) return;
  glassAffinityOn = want;
  const applyTo = async (win) => {
    if (!win || win.isDestroyed()) return;
    const hwnd = Number(win.getNativeWindowHandle().readBigInt64LE(0));
    await runPs('affinity.ps1', [String(hwnd), want ? 'exclude' : 'include']);
  };
  await applyTo(islandWin); await applyTo(gameStripWin); await applyTo(dockWin);
  islandWin.webContents.send('obs-updated', obsState);
}

// ---------- Taskbar dock (optional, off by default) ----------
// Centred bottom dock: pinned apps + running apps with indicator dots, a
// Mac-style minimise animation (the dock icon plays the animation while the
// window minimises via ShowWindow), Start, clock and show-desktop. It steps
// aside for maximised windows and games and returns when the pointer is
// pushed to the bottom edge.
function createDockWindow() {
  if (dockWin && !dockWin.isDestroyed()) return dockWin;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  dockWin = new BrowserWindow({
    width: 843, height: 60, x: Math.round((sw - 843) / 2), y: sh - 68, // v1.0.0: floating centred pill 843x60 @1920, per the reference taskbar (r-022 crop: ~560x40 @1276)
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, focusable: false, hasShadow: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  dockWin.setMenu(null); // item 16
  dockWin.loadFile(path.join(__dirname, 'renderer', 'dock.html'));
  dockWin.setIgnoreMouseEvents(false);
  dockWin.on('closed', () => { dockWin = null; });
  return dockWin;
}
async function refreshDockRunning() {
  if (!dockWin || dockWin.isDestroyed()) return;
  if (IS_WIN) {
    const r = await psJson('windows.ps1', ['list']);
    // windows.ps1 'list' returns {hwnd,title,process,exe} — exe is the full
    // path when readable, else the process name. Filter out title-less and
    // shell windows; the dock renderer matches pinned vs running by exe.
    dockRunning = r.ok ? (r.data.windows || []).filter(w => w.title && w.process && w.process.toLowerCase() !== 'explorer') : [];
  } else dockRunning = [];
  dockWin.webContents.send('dock-updated', { pinned: settings.taskbar.pinned || [], running: dockRunning });
}
// Per-exe icon cache (data:image/png;base64 or ''): icons are extracted once
// per exe via windows.ps1 'icons' — never re-extracted on every dock poll.
let dockIconCache = new Map(); // key: exe path or process name (lowercased) -> data URL or ''
async function iconsForPaths(paths) {
  const out = {};
  const missing = [];
  for (const p of paths) {
    if (!p) continue;
    const key = String(p).toLowerCase();
    if (dockIconCache.has(key)) out[p] = dockIconCache.get(key);
    else missing.push(p);
  }
  if (missing.length && IS_WIN) {
    const r = await psJson('windows.ps1', ['icons', ...missing]);
    if (r.ok) for (const it of (r.data.icons || [])) { dockIconCache.set(String(it.exe || '').toLowerCase(), it.icon || ''); out[it.exe] = it.icon || ''; }
    for (const p of missing) if (!(p in out)) { dockIconCache.set(String(p).toLowerCase(), ''); out[p] = ''; }
  } else for (const p of missing) out[p] = '';
  return out;
}
// Item 10(a): migration — replace the v2 fake defaults with the real pinned
// apps read from %APPDATA%\...\User Pinned\TaskBar\*.lnk. Only the name/path
// are stored in settings.json (icons are runtime-only, never persisted).
async function migratePinnedApps() {
  if (!pinnedMigrationPending) return;
  pinnedMigrationPending = false;
  if (!IS_WIN) return; // no Windows taskbar to read on Linux; pinned stays []
  const r = await psJson('pinned-apps.ps1');
  if (r.ok && Array.isArray(r.data.pinned)) {
    settings.taskbar.pinned = r.data.pinned.map(p => ({ name: p.name || '', path: p.path || '' })).filter(p => p.name || p.path);
    saveSettings(); pushSettingsToIsland();
  }
  // On failure pinned stays [] (honest — no fake defaults are ever restored).
}
// Item 10(d): dock-list returns {pinned:[{name,path,icon}], running:
// [{hwnd,title,exe,icon}], foregroundHwnd} — icon is a data:image/png;base64
// string or '' when unavailable (never a fake/emoji placeholder).
async function buildDockList() {
  await refreshDockRunning();
  const pinned = settings.taskbar.pinned || [];
  const pinnedIcons = await iconsForPaths(pinned.map(p => p.path));
  const runningIcons = await iconsForPaths(dockRunning.map(w => w.exe || w.process));
  return {
    pinned: pinned.map(p => ({ name: p.name || '', path: p.path || '', icon: pinnedIcons[p.path] || '' })),
    running: dockRunning.map(w => ({ hwnd: w.hwnd, title: w.title || '', exe: w.exe || w.process || '', icon: runningIcons[w.exe || w.process] || '' })),
    foregroundHwnd: foregroundState ? foregroundState.hwnd : null,
  };
}
function applyDock() {
  if (settings.taskbar.enabled) {
    const win = createDockWindow();
    if (!win.isVisible()) win.show();
    refreshDockRunning();
    if (!dockPoll) {
      dockPoll = setInterval(() => { refreshDockRunning(); applyDockStepAside(); }, 1000);
      if (dockPoll.unref) dockPoll.unref();
    }
  } else {
    if (dockPoll) { clearInterval(dockPoll); dockPoll = null; }
    if (dockWin && !dockWin.isDestroyed()) dockWin.close();
    dockWin = null;
  }
}
function applyDockStepAside() {
  if (!dockWin || dockWin.isDestroyed() || !settings.taskbar.enabled) return;
  const fg = foregroundState;
  const busy = fg && (fg.isFullscreen || fg.isMaximized) && fg.process !== 'explorer';
  if (!busy) { if (!dockWin.isVisible()) dockWin.show(); return; }
  // Maximised window or game in front: hide, unless the pointer is pushed
  // to the bottom edge (then show until it leaves the dock area).
  const p = getPointerPos();
  const { height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const atBottomEdge = p.y >= sh - 4;
  const overDock = dockWin.isVisible() && p.y >= sh - 80;
  if (atBottomEdge || overDock) { if (!dockWin.isVisible()) dockWin.show(); }
  else if (dockWin.isVisible()) dockWin.hide();
}

// ---------- FPS (DWM composition rate) ----------
// Sampled every 2s in the stats interval. Shown only when: consent allowed,
// a non-shell window is fullscreen/maximised, and two consecutive samples
// agree (kills false positives from transient desktop animation). Otherwise
// the strip shows an honest "—".
async function sampleFps() {
  if (!IS_WIN || settings.gaming.fpsConsent !== 'allowed') { currentFps = null; return; }
  const fg = foregroundState;
  const gameLike = fg && (fg.isFullscreen || fg.isMaximized) && fg.process !== 'explorer' && fg.class !== 'Progman' && fg.class !== 'WorkerW';
  if (!gameLike) { fpsSamples = []; currentFps = null; return; }
  const r = await psJson('fps.ps1', ['16']);
  const fps = r.ok && r.data && typeof r.data.fps === 'number' ? r.data.fps : null;
  if (fps == null) { fpsSamples = []; currentFps = null; return; }
  fpsSamples.push(fps);
  if (fpsSamples.length > 2) fpsSamples.shift();
  if (fpsSamples.length === 2 && Math.abs(fpsSamples[0] - fpsSamples[1]) / Math.max(1, fpsSamples[1]) <= 0.2) currentFps = Math.round((fpsSamples[0] + fpsSamples[1]) / 2);
  else if (fpsSamples.length < 2) currentFps = null;
}

// ---------- OBS (obs-websocket-js) ----------
const { OBSWebSocket } = require('obs-websocket-js');
async function connectObs() {
  if (!settings.streaming.obsEnabled) { disconnectObs(); return; }
  if (obsClient) return; // already connected or connecting
  const { obsHost, obsPort, obsPassword } = settings.streaming;
  obsClient = new OBSWebSocket();
  try {
    await obsClient.connect(`ws://${obsHost}:${obsPort}`, obsPassword || undefined, { rpcVersion: 1 });
    const rec = await obsClient.call('GetRecordStatus');
    const stream = await obsClient.call('GetStreamStatus').catch(() => ({ outputActive: false }));
    const scene = await obsClient.call('GetCurrentProgramScene');
    obsState = { connected: true, recording: !!rec.outputActive, streaming: !!stream.outputActive, recordMs: 0, scene: scene.currentProgramSceneName || '', error: '' };
    obsClient.on('RecordStateChanged', (d) => { obsState.recording = d.outputActive; islandWin?.webContents.send('obs-updated', obsState); applyGlassAffinity(); });
    obsClient.on('StreamStateChanged', (d) => { obsState.streaming = d.outputActive; islandWin?.webContents.send('obs-updated', obsState); applyGlassAffinity(); });
    obsClient.on('CurrentProgramSceneChanged', (d) => { obsState.scene = d.sceneName; islandWin?.webContents.send('obs-updated', obsState); });
    obsClient.on('ConnectionClosed', () => { obsState = { connected: false, recording: false, streaming: false, recordMs: 0, scene: '', error: 'Connection closed' }; islandWin?.webContents.send('obs-updated', obsState); obsClient = null; scheduleObsRetry(); });
    islandWin?.webContents.send('obs-updated', obsState);
  } catch (e) {
    obsState = { connected: false, recording: false, streaming: false, recordMs: 0, scene: '', error: e.message || 'Could not connect to OBS' };
    obsClient = null;
    islandWin?.webContents.send('obs-updated', obsState);
    scheduleObsRetry();
  }
}
function scheduleObsRetry() {
  if (obsRetryTimer || !settings.streaming.obsEnabled) return;
  obsRetryTimer = setTimeout(() => { obsRetryTimer = null; connectObs(); }, 10000);
  if (obsRetryTimer.unref) obsRetryTimer.unref();
}
function disconnectObs() {
  if (obsRetryTimer) { clearTimeout(obsRetryTimer); obsRetryTimer = null; }
  if (obsClient) { try { obsClient.disconnect(); } catch { /* already gone */ } obsClient = null; }
  obsState = { connected: false, recording: false, streaming: false, recordMs: 0, scene: '', error: '' };
  islandWin?.webContents.send('obs-updated', obsState);
}

// ---------- Render-folder watch ----------
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v']);
function applyRenderWatch() {
  if (renderWatcher) { renderWatcher.close(); renderWatcher = null; }
  if (renderScanTimer) { clearInterval(renderScanTimer); renderScanTimer = null; }
  const folder = settings.streaming.renderFolder || '';
  renderState = { folder, latest: null };
  if (!folder || !fs.existsSync(folder)) return;
  try {
    const scan = () => {
      try {
        const files = fs.readdirSync(folder).filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
          .map(f => { const st = fs.statSync(path.join(folder, f)); return { name: f, size: st.size, mtime: st.mtimeMs }; })
          .sort((a, b) => b.mtime - a.mtime);
        const latest = files[0] || null;
        if (latest) {
          const prev = renderState.latest;
          const done = prev && prev.name === latest.name && prev.size === latest.size;
          renderState.latest = { ...latest, done: !!done, growing: prev && prev.name === latest.name && latest.size > prev.size };
        } else renderState.latest = null;
      } catch { /* folder unreadable */ }
      islandWin?.webContents.send('render-updated', renderState);
    };
    renderWatcher = fs.watch(folder, { persistent: false }, () => scan());
    scan();
    // Re-scan 2s later: a file whose size stopped growing is "done".
    renderScanTimer = setInterval(scan, 2000);
    if (renderScanTimer.unref) renderScanTimer.unref();
  } catch { /* watch unsupported */ }
}

// ---------- App notifications (the island's own, on-PC only) ----------
function addAppNotification(text, kind) {
  appNotifications = [{ id: Date.now(), text: String(text).slice(0, 300), kind: kind || 'app', ts: Date.now() }, ...appNotifications].slice(0, 50);
  saveJson(NOTIF_PATH, appNotifications);
  islandWin?.webContents.send('notifications-updated', appNotifications);
}

// ---------- Local servers ----------
// Localhost-only: scripts/CLI endpoint (POST /notify, GET /tile) — never binds LAN.
function startLocalServer() {
  localServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/notify') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
      req.on('end', () => {
        try { const { text } = JSON.parse(body || '{}'); if (text) islandWin?.webContents.send('script-notify', String(text).slice(0, 200)); } catch { /* bad json */ }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  localServer.listen(LOCAL_PORT, '127.0.0.1');
  // A second instance (or a leftover process) holding the port must not crash
  // the app with an uncaught-exception dialog — log and carry on without it.
  localServer.on('error', (e) => console.error('[openisland] local notify server failed to listen on', LOCAL_PORT, '-', e.message));
}
// LAN server: Deck + file share. Only started when Deck or file sharing is enabled.
async function startDeckServer() {
  if (deckServer) return deckServer;
  const QR = QRCode;
  deckServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(deckHtml()); return; }
    if (url.pathname === '/api/state') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ media: mediaState, shelf: shelf.map(f => ({ name: f.name, size: f.size })) })); return; }
    if (url.pathname.startsWith('/file/')) {
      const name = decodeURIComponent(url.pathname.slice(6));
      const f = shelf.find(x => x.name === name);
      if (!f || !fs.existsSync(f.path)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"` });
      fs.createReadStream(f.path).pipe(res); return;
    }
    if (req.method === 'POST' && url.pathname === '/upload') { // phone -> PC (two-way)
      const name = decodeURIComponent(url.searchParams.get('name') || `upload-${Date.now()}`);
      const dest = path.join(app.getPath('downloads'), name);
      const ws = fs.createWriteStream(dest);
      req.pipe(ws).on('finish', () => {
        shelf.push({ name, path: dest, size: fs.statSync(dest).size, ts: Date.now(), from: 'phone' });
        saveJson(SHELF_PATH, shelf);
        islandWin?.webContents.send('shelf-updated', shelf);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/media') { // deck media controls
      let b = ''; req.on('data', c => b += c); req.on('end', async () => {
        try { const { cmd } = JSON.parse(b || '{}'); if (cmd) await mediaCommand(cmd); } catch { /* ignore */ }
        res.writeHead(200); res.end('{}');
      }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/trackpad') { // Deck trackpad: relative cursor movement + tap = click
      let b = ''; req.on('data', c => b += c); req.on('end', async () => {
        try {
          const { dx, dy, click } = JSON.parse(b || '{}');
          if (click) await psJson('windows.ps1', ['click']);
          else if (dx || dy) await psJson('windows.ps1', ['move', String(Math.round(dx)), String(Math.round(dy))]);
        } catch { /* ignore */ }
        res.writeHead(200); res.end('{}');
      }); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => deckServer.listen(DECK_PORT, '0.0.0.0', r));
  return deckServer;
}
function deckHtml() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenIsland Deck</title>
  <style>body{font-family:system-ui;background:#111;color:#eee;margin:0;padding:16px}button{font-size:18px;padding:14px 18px;margin:6px;border-radius:12px;border:0;background:#333;color:#fff}h1{font-size:20px}#pad{height:180px;background:#222;border-radius:16px;margin:12px 0;touch-action:none;display:flex;align-items:center;justify-content:center;color:#888}</style></head>
  <body><h1>OpenIsland Deck</h1><div id="pad">Trackpad — drag to move the PC cursor, tap to click</div>
  <div><button onclick="m('previous')" aria-label="Previous"><svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><polygon points="19 20 9 12 19 4"/><rect x="5" y="5" width="2" height="14"/></svg></button><button onclick="m('toggle')" aria-label="Play or pause"><svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><polygon points="7 4 20 12 7 20"/></svg></button><button onclick="m('next')" aria-label="Next"><svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><polygon points="5 4 15 12 5 20"/><rect x="17" y="5" width="2" height="14"/></svg></button></div>
  <div id="files"></div>
  <script>async function m(c){await fetch('/api/media',{method:'POST',body:JSON.stringify({cmd:c})})}
  fetch('/api/state').then(r=>r.json()).then(s=>{document.getElementById('files').innerHTML=s.shelf.map(f=>'<p><a style="color:#7cf" href="/file/'+encodeURIComponent(f.name)+'">'+f.name+'</a></p>').join('')||'<p>No files on the shelf yet.</p>'});
  // Trackpad: relative movement (scaled 1.6x) + tap = click. Batches deltas.
  const pad = document.getElementById('pad');
  let lastX = null, lastY = null, moved = 0, pendX = 0, pendY = 0, flushTimer = null;
  function flush() { if (pendX || pendY) { fetch('/api/trackpad',{method:'POST',body:JSON.stringify({dx:pendX,dy:pendY})}); pendX = 0; pendY = 0; } flushTimer = null; }
  pad.addEventListener('pointerdown', (e) => { lastX = e.clientX; lastY = e.clientY; moved = 0; pad.setPointerCapture(e.pointerId); });
  pad.addEventListener('pointermove', (e) => {
    if (lastX == null) return;
    const dx = (e.clientX - lastX) * 1.6, dy = (e.clientY - lastY) * 1.6;
    lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    pendX += dx; pendY += dy;
    if (!flushTimer) flushTimer = setTimeout(flush, 33);
  });
  pad.addEventListener('pointerup', () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } flush(); if (moved < 6) fetch('/api/trackpad',{method:'POST',body:JSON.stringify({click:true})}); lastX = null; });
  pad.addEventListener('pointercancel', () => { lastX = null; });</script></body></html>`;
}
function lanAddress() {
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  return '127.0.0.1';
}

// ---------- Mic mute (Windows Core Audio via helper; v1-partial — see README) ----------
async function toggleMicMute() {
  if (!IS_WIN) return { ok: false, error: 'Mic mute helper is Windows-only. On Linux the hotkey only toggles the UI state.' };
  const r = await runPs('mic-mute.ps1', [settings.calls.micMuted ? 'unmute' : 'mute']);
  if (r.ok) { settings.calls.micMuted = !settings.calls.micMuted; saveSettings(); islandWin?.webContents.send('mic-state', settings.calls.micMuted); }
  return r;
}

// ---------- IPC ----------
// v5.0.3 (item 8): the island is desktop-only, permanently — no live patch
// may ever flip the scope back to 'all' (the Settings toggle is gone).
function forceDesktopScope() { if (settings.island) settings.island.scope = 'desktop'; }
// v1.0.0 (item D): hide-on-its-own can never come back through a saved patch.
function forceTaskbarRule() { if (settings.taskbar) { settings.taskbar.hideWindowsTaskbar = false; settings.taskbar.autoHideOnSide = false; } }
function setupIpc() {
  ipcMain.handle('get-settings', () => settings);
  ipcMain.handle('save-settings', (e, patch) => {
    settings = deepMerge(settings, patch); forceDesktopScope(); forceTaskbarRule(); saveSettings(); applySettingsSideEffects();
    if (patch.appearance && patch.appearance.borderWallpaper !== undefined) pushBorderWallpaper();
    return settings;
  });
  // Feature A (v2.0.0): border wallpaper — file picker copies into USER_DATA.
  ipcMain.handle('pick-wallpaper', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    });
    if (canceled || !filePaths.length) return { ok: false };
    try {
      fs.mkdirSync(WALLPAPERS_DIR, { recursive: true });
      const safe = path.basename(filePaths[0]).replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(WALLPAPERS_DIR, Date.now() + '-' + safe);
      fs.copyFileSync(filePaths[0], dest);
      settings.appearance.borderWallpaper = 'file:' + path.basename(dest);
      saveSettings(); pushBorderWallpaper();
      return { ok: true, value: settings.appearance.borderWallpaper };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('get-border-wallpaper', () => borderWallpaperCssValue());
  ipcMain.handle('set-border-wallpaper', (e, value) => {
    settings.appearance.borderWallpaper = value || '';
    saveSettings(); pushBorderWallpaper();
    return borderWallpaperCssValue();
  });
  // Feature B (v2.0.0): renderer reports the Ctrl key state from forwarded
  // mousemove events (they carry event.ctrlKey even while click-through).
  ipcMain.on('ctrl-state', (e, held) => { ctrlHeld = !!held; applyClickThrough(); });
  // Live-apply (v2.0.0): apply a patch in memory + to the island NOW, without
  // writing the file — the Settings page debounces the disk write (~300ms)
  // for rapid inputs (sliders, colour dragging, text fields).
  ipcMain.on('apply-settings', (e, patch) => {
    settings = deepMerge(settings, patch); forceDesktopScope(); forceTaskbarRule(); applySettingsSideEffects();
    if (patch.appearance && patch.appearance.borderWallpaper !== undefined) pushBorderWallpaper();
  });
  // FPS consent (one-time flow): the strip only measures once the user allows it.
  ipcMain.handle('fps-consent', (e, choice) => {
    settings.gaming.fpsConsent = choice === 'allowed' ? 'allowed' : 'denied';
    saveSettings(); pushSettingsToIsland();
    return settings.gaming.fpsConsent;
  });
  // Pop-ups (also the xvfb test hook for the pop-up window).
  ipcMain.handle('show-popup', (e, p) => { showPopup(p); return true; });
  // Favourite apps (6 slots).
  ipcMain.handle('pick-favourite', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Applications', extensions: IS_WIN ? ['exe', 'lnk'] : ['*'] }],
    });
    if (canceled || !filePaths.length) return { ok: false };
    return { ok: true, path: filePaths[0], name: path.basename(filePaths[0]).replace(/\.(exe|lnk)$/i, '') };
  });
  ipcMain.handle('launch-favourite', (e, i) => {
    const f = (settings.favourites || [])[i];
    if (f && f.path) { shell.openPath(f.path).catch(() => { }); return { ok: true }; }
    return { ok: false, error: 'empty slot' };
  });
  // Live wallpaper (opt-in).
  ipcMain.handle('pick-live-wallpaper', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi'] }],
    });
    if (canceled || !filePaths.length) return { ok: false };
    // Videos stay where they are (they can be huge — no copy); moving the
    // file later disables the wallpaper with a note instead of breaking.
    settings.liveWallpaper.file = filePaths[0];
    saveSettings(); pushSettingsToIsland();
    return { ok: true, file: filePaths[0] };
  });
  ipcMain.handle('live-wallpaper-state', () => ({ enabled: settings.liveWallpaper.enabled, file: settings.liveWallpaper.file, fileOk: liveWallpaperFileOk(), paused: wallpaperPaused, attached: wallpaperAttached }));
  // Notifications (Windows toasts via helper + the app's own list).
  ipcMain.handle('notifications-list', async () => {
    let windows = { ok: false, error: IS_WIN ? 'not requested yet' : 'Windows-only', items: [] };
    if (IS_WIN) { const r = await psJson('notifications.ps1', ['list']); windows = r.ok ? { ok: true, items: r.data.items || [] } : { ok: false, error: r.error || 'listener unavailable', items: [] }; }
    return { app: appNotifications, windows };
  });
  ipcMain.handle('notifications-request', async () => {
    if (!IS_WIN) return { ok: false, error: 'Windows-only' };
    const r = await psJson('notifications.ps1', ['request']);
    return r.ok ? { ok: true, access: r.data.access } : { ok: false, error: r.error || 'request failed' };
  });
  // OBS (real client; the old stub is gone).
  ipcMain.handle('obs-status', () => obsState);
  ipcMain.handle('obs-record-toggle', async () => {
    if (!obsClient || !obsState.connected) return { ok: false, error: 'OBS is not connected' };
    try {
      if (obsState.recording) await obsClient.call('StopRecord');
      else await obsClient.call('StartRecord');
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('obs-stream-toggle', async () => {
    if (!obsClient || !obsState.connected) return { ok: false, error: 'OBS is not connected' };
    try {
      if (obsState.streaming) await obsClient.call('StopStream');
      else await obsClient.call('StartStream');
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('obs-connect', async () => { await connectObs(); return obsState; });
  // Render-folder watch.
  ipcMain.handle('render-list', () => renderState);
  // Region snip.
  ipcMain.on('snip-start', () => {
    if (snipWin && !snipWin.isDestroyed()) { snipWin.focus(); return; }
    const { width: sw, height: sh } = screen.getPrimaryDisplay().size;
    snipWin = new BrowserWindow({
      width: sw, height: sh, x: 0, y: 0, frame: false, transparent: true,
      alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: true, hasShadow: false, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
    });
    snipWin.setMenu(null); // item 16
    snipWin.loadFile(path.join(__dirname, 'renderer', 'snip.html'));
    snipWin.on('closed', () => { snipWin = null; });
  });
  ipcMain.on('snip-cancel', () => { if (snipWin && !snipWin.isDestroyed()) snipWin.close(); });
  ipcMain.on('snip-region', async (e, rect) => {
    if (snipWin && !snipWin.isDestroyed()) snipWin.close();
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: screen.getPrimaryDisplay().size.width, height: screen.getPrimaryDisplay().size.height } });
      if (!sources.length) { showPopup({ icon: 'scissors', text: 'Snip failed', sub: 'No screen source' }); return; }
      const img = sources[0].thumbnail;
      const crop = img.crop({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
      fs.mkdirSync(app.getPath('pictures'), { recursive: true });
      const file = path.join(app.getPath('pictures'), `openisland-snip-${Date.now()}.png`);
      fs.writeFileSync(file, crop.toPNG());
      clipboard.writeImage(crop);
      showPopup({ icon: 'scissors', text: 'Snip copied to clipboard', sub: path.basename(file) });
      addAppNotification('Snip saved: ' + path.basename(file), 'snip');
    } catch (err) { showPopup({ icon: 'scissors', text: 'Snip failed', sub: 'Could not save the snip — try again' }); }
  });
  // Full screenshot (desktopCapturer, was a v1 stub) → Pictures + clipboard.
  ipcMain.handle('screenshot', async () => {
    try {
      const { width, height } = screen.getPrimaryDisplay().size;
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
      if (!sources.length) return { ok: false, error: 'No screen source' };
      const img = sources[0].thumbnail;
      fs.mkdirSync(app.getPath('pictures'), { recursive: true });
      const file = path.join(app.getPath('pictures'), `openisland-${Date.now()}.png`);
      fs.writeFileSync(file, img.toPNG());
      clipboard.writeImage(img);
      addAppNotification('Screenshot saved: ' + path.basename(file), 'screenshot');
      return { ok: true, file };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  // Screen recording (webm from the renderer MediaRecorder).
  ipcMain.handle('recording-save', async (e, buf) => {
    try {
      const file = path.join(app.getPath('videos'), `openisland-recording-${Date.now()}.webm`);
      fs.mkdirSync(app.getPath('videos'), { recursive: true });
      fs.writeFileSync(file, Buffer.from(buf));
      addAppNotification('Recording saved: ' + path.basename(file), 'recording');
      return { ok: true, file };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  // Web drawer (pinned sites open in the default browser — the reliable option).
  ipcMain.handle('web-open', (e, url) => { if (url) shell.openExternal(url); return { ok: true }; });
  // Taskbar dock.
  ipcMain.handle('dock-list', async () => buildDockList());
  // v5.0.0 (item F): Dev/test hook only — exposes the internal scope /
  // fullscreen / click-through state so the rig can verify item F against
  // the real code path on Linux (OI_TEST_FOREGROUND simulates the
  // foreground window). Registered ONLY when a test hook is set; absent in
  // production. `ignoreMouse` is the last value passed to
  // setIgnoreMouseEvents (Electron has no getter for it).
  // v1.0.2: OI_FG_SERVER_CMD also registers it — the scope suite runs
  // against the persistent-process reader in that mode, and without this
  // channel it cannot read the island state at all.
  if (process.env.OI_TEST_FOREGROUND || process.env.OI_FG_SERVER_CMD) {
    ipcMain.handle('debug-state', () => ({
      visible: islandWin ? islandWin.isVisible() : false,
      collapsed: islandCollapsed,
      scope: settings.island.scope,
      clickThroughMode: settings.island.clickThroughMode,
      fullscreenForeground,
      effectiveHoldCtrl: effectiveHoldCtrl(),
      ctrlHeld,
      ignoreMouse: lastIgnoreMouseEvents,
      foreground: foregroundState,
      // v5.0.1 (item 3): dock visibility + foreground freshness, so the rig
      // can verify the stale-state fail-open and the dock step-aside.
      dockVisible: !!(dockWin && !dockWin.isDestroyed() && dockWin.isVisible()),
      fgLastReadingAt,
      fgHasReading,
      fgStaleFailOpen: fgStaleFailOpenLogged,
      windowsTaskbarHidden,
      // v5.0.2 (item 1): stay-open state, so the rig can verify a click-open
      // stays open with the pointer far away.
      pointerEntered: pointerEnteredSinceExpand,
      expandAt,
      // v1.0.1: persistent-foreground-failure state, so the rig can
      // verify the time-based fail-closed hide (no confirmed reading for
      // 10 s) and the last-confirmed timestamp it is measured from.
      fgPersistentFailure,
      fgLastConfirmedAt,
      // v1.0.2: persistent foreground helper process state, so the rig can
      // verify the server is up (and the fail-closed tests run against the
      // real reader, not the stub path).
      fgServerAlive: !!(fgServer && !fgServer.dead),
    }));
  }
  // v5.0.1 (item 4): renderer self-check channel — the Settings window
  // reports a CSS load failure here so it lands in openisland.log. The
  // message is a short diagnostic string, never a path or raw error.
  ipcMain.handle('log-diagnostic', (e, msg) => { if (typeof msg === 'string' && msg) logLine('settings: ' + msg.slice(0, 300)); return { ok: true }; });
  // v5.0.0 (item D3): live taskbar status for Settings → Taskbar — the
  // verified hide/show result plus whether the island dock is actually on
  // screen, so the state is visible instead of guessed.
  ipcMain.handle('taskbar-status', () => ({
    enabled: settings.taskbar.enabled,
    hideWindowsTaskbar: settings.taskbar.hideWindowsTaskbar,
    windowsHidden: windowsTaskbarHidden,
    verified: taskbarLastResult.ok,
    verifiedAt: taskbarLastResult.verifiedAt,
    dockOn: !!(dockWin && !dockWin.isDestroyed() && dockWin.isVisible()),
  }));
  // v5.0.0 (item C): honest fallback for tiles whose programmatic toggle
  // cannot work reliably (Night Light, Focus) — open the matching Windows
  // Settings page instead of being a dead button. Only ms-settings: URIs.
  ipcMain.handle('open-settings-uri', (e, uri) => {
    if (typeof uri !== 'string' || !uri.startsWith('ms-settings:')) return { ok: false, error: 'unsupported settings page' };
    shell.openExternal(uri);
    return { ok: true };
  });
  ipcMain.on('open-island-tab', (e, tab) => {
    if (!islandWin) return;
    islandWin.show(); setIslandCollapsed(false);
    islandWin.webContents.send('switch-tab', tab);
  });
  ipcMain.handle('dock-action', async (e, action, arg) => {
    switch (action) {
      case 'focus': return psJson('windows.ps1', ['focus', String(arg)]);
      case 'minimize': return psJson('windows.ps1', ['minimize', String(arg)]);
      case 'restore': return psJson('windows.ps1', ['restore', String(arg)]);
      case 'launch': if (arg) shell.openPath(arg); return { ok: true };
      case 'show-desktop': return psJson('windows.ps1', ['show-desktop']);
      case 'start-menu': return psJson('windows.ps1', ['start-menu']);
      case 'open-tray-settings': shell.openExternal('ms-settings:notifications'); return { ok: true };
      default: return { ok: false, error: 'unknown dock action' };
    }
  });
  ipcMain.handle('pick-taskbar-app', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Applications', extensions: IS_WIN ? ['exe', 'lnk'] : ['*'] }],
    });
    if (canceled || !filePaths.length) return { ok: false };
    return { ok: true, path: filePaths[0], name: path.basename(filePaths[0]).replace(/\.(exe|lnk)$/i, '') };
  });
  // Network throughput + power state (Widgets stats card, dock tray).
  // v1.0.2: netstat never overlaps itself — the renderer asks every 5 s
  // and netstat.ps1 spawns a fresh powershell.exe per call, so on a slow
  // machine overlapping calls piled up and timed out at 15 s. A call in
  // flight returns the last-known value instead of spawning another
  // process; the timeout is 30 s so a slow (not hung) machine is not
  // killed. This can never block the foreground poll (separate interval,
  // and the foreground checks no longer spawn per poll at all).
  let netstatInFlight = false;
  let lastNetworkResult = null;
  ipcMain.handle('get-network', async () => {
    if (!IS_WIN) {
      try {
        const read = () => { const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2); let rx = 0, tx = 0; for (const l of lines) { const p = l.trim().split(/\s+/); if (p.length > 9 && p[0] !== 'lo:') { rx += +p[1]; tx += +p[9]; } } return { rx, tx }; };
        const a = read(); await new Promise(r => setTimeout(r, 500)); const b = read();
        return { ok: true, down: Math.round((b.rx - a.rx) * 2), up: Math.round((b.tx - a.tx) * 2) };
      } catch { return { ok: false, error: 'network counters unavailable' }; }
    }
    if (netstatInFlight) return lastNetworkResult || { ok: false, error: 'network counters busy' };
    netstatInFlight = true;
    const r = await psJson('netstat.ps1', [], 30000);
    netstatInFlight = false;
    if (r.ok) lastNetworkResult = { ok: true, down: r.data.down, up: r.data.up };
    return r.ok ? lastNetworkResult : { ok: false, error: r.error };
  });
  ipcMain.handle('get-power', async () => {
    if (!IS_WIN) return { ok: false, error: 'Windows-only' };
    const r = await psJson('power.ps1');
    return r.ok ? { ok: true, acOnline: r.data.acOnline, saverOn: r.data.saverOn, batteryPct: r.data.batteryPct } : { ok: false, error: r.error };
  });
  ipcMain.handle('get-stats', getStats);
  ipcMain.handle('get-media', () => mediaState);
  ipcMain.handle('media-command', (e, cmd, sessionId, value) => mediaCommand(cmd, sessionId, value));
  ipcMain.handle('set-inapp-media', (e, m) => {
    // The in-app player is only the fallback: it becomes a session when no
    // SMTC session exists, and never overrides real apps that are playing.
    if (mediaState.source === 'smtc' && mediaState.sessions.length) return true;
    const inapp = { id: 'inapp', app: 'OpenIsland player', title: m.title || '', artist: m.artist || '', album: m.album || '', status: m.status || 'paused', position: m.position || 0, duration: m.duration || 0, artwork: '' };
    mediaState = { source: 'inapp', sessions: [inapp], activeIndex: 0, error: null };
    islandWin?.webContents.send('media-updated', mediaState);
    maybeShowNowPlayingChip();
    return true;
  });
  ipcMain.handle('lyrics-lookup', async (e, { title, artist, album, duration }) => {
    if (!settings.lyrics.enabled) return { ok: false, error: 'Lyrics are off (Settings → Panels → Lyrics). Nothing about music leaves the PC while off.' };
    try {
      const q = new URLSearchParams({ track_name: title || '', artist_name: artist || '', album_name: album || '', duration: String(Math.round(duration || 0)) });
      const r = await fetch('https://lrclib.net/api/get?' + q.toString(), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { ok: false, error: 'No lyrics found on LRCLIB for this track.' };
      const j = await r.json();
      return { ok: true, plain: j.plainLyrics || '', synced: j.syncedLyrics || '' };
    } catch (err) { return { ok: false, error: 'Lyrics lookup failed: ' + err.message }; }
  });
  ipcMain.handle('weather', async () => {
    try {
      const { weatherLat, weatherLon } = settings.widgets;
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${weatherLat}&longitude=${weatherLon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status);
      const j = await r.json();
      return { ok: true, data: j.current, daily: { max: j.daily?.temperature_2m_max?.[0] ?? null, min: j.daily?.temperature_2m_min?.[0] ?? null } };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('clipboard-list', () => clipHistory);
  ipcMain.handle('clipboard-copy', (e, text) => { clipboard.writeText(text); lastClipText = text; return true; });
  ipcMain.handle('clipboard-delete', (e, id) => { clipHistory = clipHistory.filter(x => x.id !== id); saveClipHistory(); return clipHistory; });
  ipcMain.handle('clipboard-pin', (e, id) => { const it = clipHistory.find(x => x.id === id); if (it) it.pinned = !it.pinned; saveClipHistory(); return clipHistory; });
  ipcMain.handle('clipboard-clear', () => { clipHistory = []; saveClipHistory(); return []; });

  ipcMain.handle('shelf-list', () => shelf);
  ipcMain.handle('shelf-add', (e, files) => {
    for (const f of files) if (f.path && fs.existsSync(f.path)) shelf.push({ name: f.name, path: f.path, size: f.size || 0, ts: Date.now(), from: 'pc' });
    saveJson(SHELF_PATH, shelf); return shelf;
  });
  ipcMain.handle('shelf-remove', (e, name) => { shelf = shelf.filter(f => f.name !== name); saveJson(SHELF_PATH, shelf); return shelf; });
  ipcMain.handle('shelf-drag-out', (e, name) => {
    const f = shelf.find(x => x.name === name);
    if (f && fs.existsSync(f.path)) { e.sender.startDrag({ file: f.path, icon: nativeImage.createEmpty() }); return true; }
    return false;
  });
  ipcMain.handle('shelf-share-qr', async () => {
    await startDeckServer();
    const url = `http://${lanAddress()}:${DECK_PORT}/`;
    return { url, qr: await QRCode.toDataURL(url, { width: 220, margin: 1 }) };
  });

  ipcMain.handle('reminders-list', () => reminders);
  ipcMain.handle('reminder-add', (e, { text, seconds }) => {
    const rem = { id: Date.now(), text, at: Date.now() + seconds * 1000, created: Date.now() };
    reminders.push(rem); saveJson(REMINDERS_PATH, reminders); scheduleReminder(rem); return reminders;
  });
  ipcMain.handle('reminder-snooze', (e, id, minutes) => {
    const rem = { id: Date.now(), text: (reminders.find(r => r.id === id) || {}).text || 'Reminder', at: Date.now() + minutes * 60000, created: Date.now() };
    reminders = reminders.filter(r => r.id !== id); reminders.push(rem); saveJson(REMINDERS_PATH, reminders); scheduleReminder(rem); return reminders;
  });
  ipcMain.handle('reminder-done', (e, id) => { reminders = reminders.filter(r => r.id !== id); saveJson(REMINDERS_PATH, reminders); if (reminderWin) reminderWin.close(); return reminders; });

  ipcMain.handle('toggle-mic-mute', toggleMicMute);
  ipcMain.handle('mic-state', () => ({ muted: settings.calls.micMuted, inUse: micInUse, camInUse, captureInUse }));
  ipcMain.handle('win-control', async (e, action, arg) => {
    // volume/brightness/wifi/bluetooth/nightlight/focus — Windows helpers, graceful elsewhere
    switch (action) {
      case 'volume-get': { const r = await psJson('volume.ps1', ['get']); if (r.ok && r.data && r.data.level != null) lastVolumeLevel = r.data.level; return r.ok ? r.data : { ok: false, error: r.error, level: null }; }
      case 'volume-set': {
        // v1.0.0 (item B): pass the last-known level so the keybd_event
        // fallback in volume.ps1 knows how far to move the keys.
        const from = lastVolumeLevel == null ? -1 : lastVolumeLevel;
        const r = await runPs('volume.ps1', ['set', String(arg), String(from)]);
        let reached = arg;
        try { const d = JSON.parse(r.output || ''); if (d && d.level != null) reached = d.level; } catch { /* output is not JSON — keep the target */ }
        if (r.ok) { lastVolumeLevel = reached; showPopup({ icon: 'volume', text: 'Volume ' + reached + '%', sub: '' }); }
        return r;
      }
      case 'brightness-get': { const r = await psJson('brightness.ps1', ['get']); return r.ok ? r.data : { ok: false, error: r.error, level: null }; }
      case 'brightness-set': { const r = await runPs('brightness.ps1', ['set', String(arg)]); if (r.ok) showPopup({ icon: 'sun', text: 'Brightness ' + arg + '%', sub: '' }); return r; }
      // v1.0.0 (item B, LOG-PROVEN): pass '1'/'0', never String(true/false)
      // — net-toggle.ps1's old [bool]$On received the literal string
      // "System.String" on PJ's machine (log 02:47:38). The script now
      // parses a [string] defensively; a [string] param receives the value
      // as-is, so '1'/'0' cannot be mangled by [bool] binding.
      case 'wifi-toggle': return runPs('net-toggle.ps1', ['wifi', arg ? '1' : '0']);
      case 'wifi-get': { const r = await psJson('net-state.ps1', ['wifi']); return r.ok ? { ok: true, on: r.data.on } : { ok: false, error: r.error }; }
      case 'bluetooth-toggle': return runPs('net-toggle.ps1', ['bluetooth', arg ? '1' : '0']);
      case 'bluetooth-get': { const r = await psJson('net-state.ps1', ['bluetooth']); return r.ok ? { ok: true, on: r.data.on } : { ok: false, error: r.error }; }
      // nightlight-toggle / focus-toggle keep String(arg): nightlight.ps1
      // and focus.ps1 take [string]$Arg and compare it to 'true'/'false'
      // literally — no [bool] binding is involved, so the String(bool)
      // shape cannot hit them.
      case 'nightlight-toggle': return runPs('nightlight.ps1', [String(arg)]);
      case 'nightlight-get': { const r = await psJson('net-state.ps1', ['nightlight']); return r.ok ? { ok: true, on: r.data.on } : { ok: false, error: r.error }; }
      case 'focus-toggle': return runPs('focus.ps1', [String(arg)]);
      case 'focus-get': { const r = await psJson('focus.ps1', ['get']); return r.ok ? r.data : { ok: false, error: r.error }; }
      case 'power-mode-get': { const r = await psJson('power-mode.ps1', ['get']); return r.ok ? { ok: true, mode: r.data.mode } : { ok: false, error: r.error }; }
      case 'power-mode-set': return runPs('power-mode.ps1', ['set', String(arg)]);
      case 'taskbar-hide': return runPs('taskbar.ps1', ['hide']);
      case 'taskbar-restore': return runPs('taskbar.ps1', ['show']);
      case 'show-desktop': return psJson('windows.ps1', ['show-desktop']);
      case 'start-menu': return psJson('windows.ps1', ['start-menu']);
      case 'open-settings': openSettingsSection(); return { ok: true };
      case 'open-path': if (arg) shell.openPath(arg); return { ok: true };
      case 'launch-app': if (arg) shell.openPath(arg); return { ok: true };
      case 'quit': app.quit(); return { ok: true };
      default: return { ok: false, error: 'unknown action ' + action };
    }
  });
  ipcMain.handle('color-pick', async () => {
    // v1: sample the centre pixel of a full-screen capture (no native colour picker yet)
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    if (!sources.length) return { ok: false, error: 'No screen source' };
    const img = sources[0].thumbnail;
    const { width, height } = img.getSize();
    const bmp = img.toBitmap();
    const x = Math.floor(width / 2), y = Math.floor(height / 2);
    const i = (y * width + x) * 4;
    const hex = '#' + [bmp[i], bmp[i + 1], bmp[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
    clipboard.writeText(hex);
    return { ok: true, hex, note: 'v1 samples the screen centre — pointer-position sampling needs a Windows native helper (v2).' };
  });
  ipcMain.handle('deck-qr', async () => {
    await startDeckServer();
    const url = `http://${lanAddress()}:${DECK_PORT}/`;
    return { url, qr: await QRCode.toDataURL(url, { width: 220, margin: 1 }) };
  });
  ipcMain.on('island-expand', () => { if (!canShowIsland()) return; setIslandCollapsed(false); });
  // Contract: resizeIsland(h) — the island reports its content height; while
  // expanded, set the window height to clamp(h, 120, workAreaHeight).
  // Width stays at the expanded width (630 by default). In-memory only —
  // the Settings live-apply save persists it on the next settings write.
  ipcMain.on('island-resize', (e, h) => {
    if (!islandWin || islandCollapsed) return;
    const workAreaHeight = screen.getPrimaryDisplay().workAreaSize.height;
    const height = Math.max(120, Math.min(Math.round(Number(h) || 0), workAreaHeight));
    if (!height) return;
    settings.island.expandedHeight = height;
    // Item A: the centre must never move on expand/collapse/resize. The old
    // code kept getBounds().x here — if this IPC arrives before the OS has
    // applied the expand setBounds, getBounds() still returns the collapsed
    // x and the card keeps the pill's left edge (centre jumps ~230px). The
    // geometry is now always recomputed from islandBounds(false), so the
    // centre is derived, never inherited from a possibly-stale read.
    islandWin.setBounds(islandBounds(false));
  });
  ipcMain.on('strip-context-menu', showStripContextMenu);
  // Item 22 (v3.0.1): the strip's hover-× — same effect as the context
  // menu's "Hide strip": showStrip=false, saved, window destroyed.
  ipcMain.on('strip-hide', () => {
    settings.gaming.showStrip = false; saveSettings();
    applyGameStrip(); pushSettingsToIsland();
  });
  // Item 24(d): close a desktop widget immediately (Settings turns one off).
  ipcMain.on('close-widget', (e, kind) => {
    const w = widgetWins[kind];
    if (w && !w.isDestroyed()) w.close();
  });
  // Hover expands are guarded: right after a cursor-poll collapse the pill may
  // still be under the pointer — ignore hover re-expands for 600ms so the
  // island can't flicker open/closed while the mouse sits still. In hold-ctrl
  // click-through mode (manual setting OR a fullscreen app in front, item F)
  // hover never expands without Ctrl held.
  ipcMain.on('island-expand-hover', () => {
    if (Date.now() < expandCooldownUntil) return;
    if (effectiveHoldCtrl() && !ctrlHeld) return;
    setIslandCollapsed(false);
  });
  ipcMain.on('island-collapse', () => setIslandCollapsed(true));
  ipcMain.on('island-hide', () => islandWin?.hide());
  ipcMain.on('open-settings', (e, section) => openSettingsSection(section));
  ipcMain.on('open-widget', (e, kind) => createDesktopWidget(kind));
  ipcMain.on('tour-done', () => {
    // BUG 1 (v2.0.0): persist + verify by reading the file back. A silent
    // failed write used to make the tour come back on every launch.
    settings.general.tourDone = true;
    saveSettings();
    // v1.0.0: the tour is a separate dialog window — close it on Done/X.
    if (tourWin && !tourWin.isDestroyed()) tourWin.close();
    try {
      const back = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      if (back?.general?.tourDone !== true) console.error('[openisland] tourDone did NOT persist to', SETTINGS_PATH);
    } catch (e) { console.error('[openisland] tourDone verify read failed:', e.message); }
  });
  ipcMain.on('notify', (e, text) => islandWin?.webContents.send('script-notify', text));
}

function applySettingsSideEffects() {
  if (settings.general.runAtStartup !== app.getLoginItemSettings().openAtLogin) {
    try { app.setLoginItemSettings({ openAtLogin: settings.general.runAtStartup }); } catch { /* Linux: no-op */ }
  }
  applyTaskbarWindows(); // Hide-the-taskbar + auto-hide-on-side + work area (restored on quit)
  applyGlassAffinity(); // Glass surface <-> screen capture exclusion
  // restore happens on quit only — never restart Explorer on a plain settings save
  applyGameStrip();
  applyClickThrough();
  applyScopePoll(); // starts the foreground watcher (also drives per-app rules)
  // v5.0.0 (item F): the desktop-only toggle must switch behaviour the moment
  // it flips, not on the next foreground change. A scope change invalidates
  // the cached rule key — without this, flipping desktop → all while an app
  // was in front stranded the island hidden forever (the rule key had not
  // changed, so the `lastAppliedRule !== key` guard in applyForegroundRules
  // never re-showed it) — then re-evaluate the rules immediately.
  if (settings.island.scope !== lastScopeSetting) {
    lastScopeSetting = settings.island.scope;
    lastAppliedRule = null;
    applyForegroundRules();
  }
  syncDesktopWidgets(); // desktop widgets follow their desktop* flags, live
  if (islandWin) { const b = islandBounds(islandCollapsed); islandWin.setBounds(b); } // keep expanded geometry while expanded (v3 fix: was islandBounds(true), which shrank the island on every settings save)
  applyLiveWallpaper();
  applyDock();
  applyRenderWatch();
  if (settings.streaming.obsEnabled) connectObs(); else disconnectObs();
  registerHotkeys();
  pushSettingsToIsland(); // live-apply: the island re-themes the moment a setting changes
}
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const k = settings.keys;
  const safe = (accel, fn) => { try { globalShortcut.register(accel, fn); } catch { /* invalid accel */ } };
  safe(k.toggleIsland, () => { if (!islandWin) return; if (islandWin.isVisible()) { setIslandCollapsed(true); return; } if (!canShowIsland()) return; islandWin.show(); setIslandCollapsed(false); });
  safe(k.muteMic, () => toggleMicMute());
  safe(k.colorPicker, () => islandWin?.webContents.send('color-pick-request'));
  safe(k.toggleGameStrip, () => { settings.gaming.showStrip = settings.gaming.showStrip === false; saveSettings(); applyGameStrip(); });
  // Favourite apps (6 slots): a global hotkey per slot launches the app.
  (settings.favourites || []).forEach((f, i) => {
    if (f && f.path && f.hotkey) safe(f.hotkey, () => { shell.openPath(f.path).catch(() => { }); });
  });
}

// ---------- App lifecycle ----------
// BUG 1 (v2.0.0): one instance only — a second double-click focuses the
// running island instead of starting a second process that could race settings.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => { if (islandWin && canShowIsland()) { islandWin.show(); setIslandCollapsed(false); } });

app.whenReady().then(() => {
  // v1.0.2: the log opens with the version, so a future log identifies the
  // build immediately (the v1.0.1 log had no version line and the build had
  // to be inferred from the fail-closed wording).
  logLine(`OpenIsland v${app.getVersion()} starting — ${process.platform} ${process.arch} — userData ${USER_DATA}`);
  Menu.setApplicationMenu(null); // item 16 (repeated here: the top-level call can run before app ready)
  clipHistory = loadClipHistory();
  for (const r of reminders) if (r.at > Date.now()) scheduleReminder(r);
  createIsland();
  startCursorPoll(); // must start at launch — createIsland alone never calls setIslandCollapsed
  createTray();
  applyScopePoll(); // starts the foreground watcher (per-app rules, scope, slim strip, wallpaper, dock)
  setupIpc();
  registerHotkeys();
  startLocalServer();
  if (settings.deck.enabled || settings.panels.deck) startDeckServer().catch(() => {});
  migratePinnedApps(); // item 10(a): v2 fake pinned defaults -> real pins from disk (Windows only)
  syncDesktopWidgets(); // item 24(b): restore desktop widgets at startup
  applyGameStrip();
  applyLiveWallpaper();
  applyDock();
  applyRenderWatch();
  applyTaskbarWindows();
  startSafetyWatchdog(); // v5.0.1 (item 3): 1s enforcement of "never neither taskbar"
  applyGlassAffinity();
  if (settings.streaming.obsEnabled) connectObs();
  setInterval(clipTick, 1000);
  setInterval(pollMedia, 2000);
  setInterval(async () => { // cheap stats push, only on change is handled in renderer
    await sampleFps();
    const s = await getStats();
    islandWin?.webContents.send('stats-updated', s);
    gameStripWin?.webContents.send('stats-updated', s);
    for (const w of Object.values(widgetWins)) w.webContents.send('stats-updated', s);
  }, 2000);
  setInterval(pollPowerAndAudio, 30000); // battery/AC/saver + headphone pop-ups (Windows)
  setInterval(() => { // mic/camera in-use detection (Windows helper; cheap poll)
    if (!IS_WIN) return;
    psJson('privacy.ps1').then(r => { if (r.ok) { micInUse = !!r.data.mic; camInUse = !!r.data.cam; captureInUse = !!r.data.capture; if (micInUse && !callStartTs) callStartTs = Date.now(); if (!micInUse) callStartTs = null; islandWin?.webContents.send('privacy-updated', { micInUse, camInUse, captureInUse, callSeconds: callStartTs ? Math.floor((Date.now() - callStartTs) / 1000) : 0 }); } });
  }, 5000);
  // v1.0.0 (§11): first run opens the tour DIALOG — the island itself stays
  // collapsed until hovered/clicked (the old code expanded the island and
  // showed the banner inside it).
  if (!settings.general.tourDone) createTourWindow();
  // Dev/test hook only: OI_START_EXPANDED=1 opens the island expanded (used for headless screenshots).
  if (process.env.OI_START_EXPANDED) islandWin?.webContents.once('did-finish-load', () => setTimeout(() => setIslandCollapsed(false), 800));
  // Dev/test hook only: OI_TEST_CLOSE_SETTINGS=1 opens Settings, closes it,
  // and logs whether the island process is still alive (item 14 verify).
  if (process.env.OI_TEST_CLOSE_SETTINGS) {
    setTimeout(() => {
      createSettingsWindow();
      setTimeout(() => {
        if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
        setTimeout(() => {
          const alive = !!islandWin && !islandWin.isDestroyed() && !isQuitting;
          console.log('[test] settings-closed island-alive=' + alive + ' settingsWin=' + (settingsWin ? (settingsWin.isDestroyed() ? 'destroyed' : (settingsWin.isVisible() ? 'visible' : 'hidden')) : 'null'));
        }, 800);
      }, 1200);
    }, 1200);
  }
  // Dev/test hook only: OI_TEST_WIDGETS=1 opens the clock widget for a screenshot.
  if (process.env.OI_TEST_WIDGETS) setTimeout(() => createDesktopWidget('clock'), 800);
  // Dev/test hook only: OI_TEST_STRIP_MENU=1 shows the strip context menu,
  // then clicks its "Hide strip" item programmatically (a real pointer click
  // on the native menu is Electron's own behaviour) and logs the result.
  if (process.env.OI_TEST_STRIP_MENU) {
    setTimeout(() => {
      showStripContextMenu();
      console.log('[test] strip menu shown, items=' + (stripContextMenu?.items.map(i => i.label).join('|') || ''));
      setTimeout(() => {
        stripContextMenu?.items[0]?.click();
        setTimeout(() => console.log('[test] strip after Hide click: showStrip=' + settings.gaming.showStrip + ' stripWin=' + (gameStripWin ? 'exists' : 'destroyed')), 600);
      }, 1200);
    }, 2000);
  }
});
app.on('window-all-closed', () => { /* tray app: keep running — no-op on Windows (item 14) */ });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  restoreTaskbarSync(); // item 9: restore the Windows taskbar + work area on quit (sync — async calls would not finish)
});
app.on('before-quit', () => {
  // Item 14: destroy the tray and restore the Windows taskbar + work area.
  isQuitting = true;
  stopForegroundServer(); // v1.0.2: kill the persistent helper process (its stdin also closes, so it would exit on its own — belt and braces)
  if (tray) { try { tray.destroy(); } catch { /* already gone */ } tray = null; }
  restoreTaskbarSync();
});
