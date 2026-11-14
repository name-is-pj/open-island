# OpenIsland v1.0.0

A **free, original** Dynamic Island / notch for Windows 10 (2004+) / 11 x64.
No account, no ads, no telemetry, no payment. Settings live in a local JSON file.

## What's new in v1.0.0 — the exact-copy pass

The island now looks like the reference design, panel for panel: black + white + red theme (near-black cards, white active fills, red progress wave), one shared card width, compact cards that fit their content, no banners or instructions inside the island, and a bare icon strip with no bar behind it.

- **Hover switches panels.** Moving the pointer onto a panel icon opens that panel right away — no click needed.
- **Volume and Wi-Fi actually work.** Volume reads and sets the real system volume (the audio connection is fixed, with the volume keys as a fallback for setting). Where Windows blocks a toggle from an unelevated app, the tile opens the matching Windows Settings page instead of a dead button — never a fake state.
- **The island only ever shows on the desktop.** A second lightweight foreground check backs up the main one, and if neither can tell what's in front, the island hides rather than sitting over your apps. The foreground check also logs its real error now, so a failing check can actually be diagnosed.
- **Taskbar rule.** The Windows taskbar hides only while the island's own taskbar is on — never on its own.
- **First-run tour is a separate dialog.** The welcome tour is its own window now; the island itself never carries a banner.
- **Settings → Appearance rebuilt.** Named surface buttons (Glass selected, white-filled), live Resting/Open preview with the real island card, no header block, no Wallpaper sidebar item — live wallpaper lives under Island now. The window is ~780 px wide and Appearance fits without scrolling.
- **Desktop widgets no longer overlap.** Day clock, weather and stats restore in a fixed grid at the top-left.
- **Taskbar pill.** Floating centred pill with the now-playing mini card (real album art), a chevron, tray icons, volume, clock with date, and bell — plus a small now-playing chip that floats above it briefly when the track changes.

## What's new in v3.0.0 — the fix release (history)

Every item below was reported from testing v2.0.0 on a real Windows 11 laptop,
and fixed against the reference design (compact cards, one width, height fits
content, premium typography, real values everywhere).

- **The island scrolls.** Mouse-wheel scroll now works over island content and the tab strip, so nothing is ever clipped — the card sizes to its content and scrolls when the content is taller.
- **Clean pill.** The collapsed pill is a true pill with no border/corner artifacts. Idle it is a bare minimal notch with no text and no clock; while music plays it shows only the live red waveform on the left and the tiny grid icon on the right.
- **Cards size to content.** One expanded width (~420px at 1276 / ~630px at 1920), height = content height only — no huge mostly-empty cards. The Music card matches the reference: album art left, title + artist, prev/pause/next, wavy red progress line, elapsed left / -remaining right, and the card glass is tinted by the album art's dominant colour (theme glass when there is no art).
- **YouTube in Chrome shows in Music.** Four real causes fixed: the media helper skipped title-less sessions (Chrome's session is briefly title-less), the poller failed silently, media commands fell back to the wrong session, and vanished sessions were dropped instantly (now a 1.5s grace period). The poll runs continuously, helper errors are shown honestly, and the empty state includes the Hardware Media Key hint. Clicking the wavy progress line seeks.
- **Tabs switch on hover.** Moving the pointer onto a tab icon opens that panel — no click needed. The top icon strip is the panel switcher and now ends with a theme icon (cycles all 10 themes) and a gear that opens Settings.
- **Controls match the reference.** White-filled vertical sliders with real % on top, tiles always show a real state word (never a bare "—"), Battery/Balanced/Performance row with the active one filled. Brightness/volume getters return real values on Windows (Core Audio COM shim for volume; WMI brightness fixed — it used to emit invalid JSON); a genuinely unavailable value says "Unavailable", never a fake number.
- **Taskbar REPLACES the Windows taskbar.** One toggle hides the Windows taskbar (all monitors) and shows the island taskbar; it comes back on toggle-off and on app exit, with a watchdog while enabled. The island taskbar mirrors the real Windows taskbar — the user's actual pinned apps (read from the TaskBar pinned folder) and live open windows, with real icons — no default extra apps.
- **Settings scrolls, and has no menu bar.** Every section is reachable by mouse-wheel scroll, and Electron's default menu bar is gone from all windows. Closing Settings closes only Settings — the app quits only via tray → Quit.
- **About.** Email, YouTube and Instagram with icons; clicking opens the default browser (email opens a mail compose).
- **Premium typography, zero emojis.** Inter (bundled, OFL) with proper weights across the whole app, every emoji replaced with clean drawn SVG icons, transport buttons are bare white icons with no pill backgrounds.
- **Motion + Visualizer settings.** Appearance now has Motion (Fluid / Balanced / Battery saver) and Visualizer (Pixels / Bars) — the pill waveform follows the Visualizer choice. Corners default to 100% (fully round) for new installs.
- **GPU % on the desktop.** The strip and Widgets PC stats show a real GPU % (the counter path now tries the 3D engine counter, then the broad GPU Engine counter, then a 2-sample read). FPS stays "—" when no game is presenting — honest, never faked.
- **Live preview shows a demo card.** When nothing is playing, the Appearance preview shows a demo music card with Resting/Open toggle; with a real track playing it shows the real track.
- **"Panels", not "Tabs".** The Settings sidebar matches the reference naming.
- **Live wallpaper has its own section.** Wallpaper in the sidebar: video picker, enable toggle, quality, fps, pause on fullscreen / battery / battery saver.
- **Strip hide is discoverable.** Right-click the strip itself → "Hide strip" (destroys the strip window) or "Strip settings". The Settings → Gaming toggle and Ctrl+Alt+G still work.
- **Contrast on every theme.** Light themes get dark text, dark themes light text, swatch labels stay readable on their own swatch colour — verified with screenshots of all 10 themes.
- **Floating desktop widgets.** Day clock, Weather and Stats each have a "Show on desktop" toggle plus a colour picker in Settings → Widgets; they restore at startup, default ON for fresh installs, and match the reference look (big day name + date, temperature + condition).
- **Taskbar now-playing shows the album art.** The mini card has the artwork thumbnail + pause.

## What's new in v2.0.0

- **Welcome tour, once only.** The first-run hint is now a small card inside the expanded island (never a full overlay over your content), it disappears the moment you tap Got it, and it never comes back — the flag is written and read back from disk, and a single-instance lock stops a second copy racing the settings file.
- **The island closes when the mouse moves away.** The main process now polls the real cursor position every 150ms while expanded and collapses the moment it leaves the island (8px margin), with a short guard so the pill under the pointer can't instantly re-expand. Renderer mouse-leave stays as a fast path. (Linux note: Electron's `getCursorScreenPoint()` is frozen at the app-start position on this Linux dev box — verified with three minimal test apps — so the poll is tested headlessly with an `OI_POINTER_FILE` mock; on Windows it is a live Win32 call.)
- **Liquid Glass redesign.** True pill with frosted glass (blur + saturate), inset top highlight, soft shadow, live content in the collapsed pill (track title, clock, animated equaliser while playing) and a spring expand animation. All 9 themes are now real, visibly different glass treatments with live preview swatches in Settings.
- **System strip on/off.** Settings → Gaming → "Show system strip" (and the same switch in the island's Gaming tab) removes the top-left CPU/RAM/GPU/FPS strip entirely — the window is destroyed, not hidden — plus a top-left / top-right position choice.
- **Music: every app, one swipe away.** The Music tab now lists every app playing audio (YouTube in Chrome/Edge, Spotify, VLC, any app) via SMTC `GetSessions()` — one card per app with artwork, title/artist, play/pause, next/previous. Swipe left/right (touch or mouse drag), use the arrows, or tap the dots. The in-app audio player stays only as the fallback when nothing else is playing, and the empty state stays honest.
- **Island border wallpaper.** Settings → Appearance → "Island border wallpaper": pick any image from the PC (copied into the app's data folder, so it survives the original being moved or deleted) or a built-in gradient preset. The wallpaper shows only in the island's border ring — collapsed pill, expanded card and notch — while the inside stays transparent glass, independent of the theme.
- **Click-through, Hold Ctrl to interact.** Settings → Island → "Click-through": when on, every click passes straight through the island to the app underneath (e.g. Chrome) — hold Ctrl and move the mouse over the island to use it. No hover exceptions: hover-to-expand also needs Ctrl held. Ctrl+Alt+N still toggles manually.
- **Show island: Only on desktop.** Settings → Island → "Show island": "Only on desktop" hides the island whenever any app window is in front (Windows foreground-window check, ~500ms); the desktop/shell brings it back. Any failure falls back to showing the island.
- **App icon.** The neon Open Island artwork is the app, tray and exe icon (embedded with a pure-JS PE step, `npm run icon:exe` — no Wine needed).
- **Live-apply settings — no Save button.** Every setting in the Settings window and the island's own controls applies the instant it changes (theme, accent colour — including dragging the colour picker — corner radius, shape, widths, open delay, every toggle and slider, per-app rules). Persistence is automatic on change (debounced ~300ms for sliders/colour/text). The Settings window itself re-themes live. There is no Save/Apply button anywhere.
- **Customizable tabs.** Settings → Tabs: a toggle per island tab (Music, Widgets, Controls, Calls, Gaming, Web, Notifications, …); the tab bar shows only enabled tabs, always at least one.
- **Sizing matched to the reference.** Collapsed pill is slim (~170px at 1920, like the reference), expanded card ~630px wide; while music plays the collapsed pill shows a live red waveform + time, and the Music card shows the album-art layout with elapsed / -remaining.
- **Real FPS in the game strip.** From Windows frame events (DWM composition rate, nothing injected into the game), borderless/windowed fullscreen only, with a one-time in-app consent prompt; honest "—" when no game is presenting or consent is off.
- **Region snip + screen recording.** Tools: drag a region to snip it (saved to Pictures + clipboard) and record the screen to webm (saved to Videos).
- **Favourite apps — 6 slots with hotkeys.** Pick an app per slot in Settings → Keys, assign a global hotkey, launch from anywhere; the 6 slots show in the Controls tab.
- **Notification mirroring.** Windows notifications in one on-PC list in the island (Notifications tab), after Windows permission; denied permission shows an honest empty state. The island's own notifications are listed too. Nothing ever leaves the PC.
- **OBS REC/LIVE pill.** Wired via `obs-websocket-js`: connects to OBS Studio's own WebSocket server, shows REC/LIVE + elapsed time + current scene, start/stop recording and stream toggles. Off by default; "not connected" when OBS isn't running.
- **Per-app rules enforced.** The foreground-app watcher (PowerShell/user32) applies each rule — hide / strip / step-aside / show — for the active app, live.
- **Deck trackpad movement.** Finger movement on the phone moves the PC cursor (relative deltas); tap = click.
- **Render-folder watch.** A chosen folder is watched for new render files; they surface in the Stream tab.
- **System pop-ups.** Transient glass pop-ups (top centre, auto-dismissing) when volume or brightness changes, and when headphones connect/disconnect (device name; headphone battery isn't exposed by any stable Windows API, so it isn't shown).
- **"See-through surface" slider.** Appearance → a 0–100% slider controlling how see-through the island glass is, applied live to pill, card and strip.
- **Web drawer for pinned sites.** A Web tab in the island holding user-pinned sites; clicking one opens it in the default browser (a `<webview>` inside the tiny transparent island window proved fragile — the browser is the reliable option).
- **"When the island opens": Last tab vs Music.** Plus a "Slim strip under maximized windows" toggle (island hides, strip shows when a window is maximised).
- **Live wallpaper (opt-in, off by default).** Pick a video file; it plays as the desktop wallpaper via Progman/WorkerW embedding. Battery controls: pauses on fullscreen apps, on battery power, and on battery saver; quality + frame-rate settings; auto-disables if the file goes missing.
- **Optional bottom taskbar replacement (off by default).** One switch in Settings → Taskbar: a centred island-style dock with Start, pinned + open apps, now-playing song, timer, tray status, quick settings and clock; windows stop above it (work area reserved). Mac-style minimise animation into the dock icon. "Hide the taskbar" hides Windows' taskbar (restored on toggle-off or app exit) and "Auto-hide it while the island is on a side" slides it away until the pointer reaches the bottom edge. Tray icons are shown as live status icons (volume, Wi-Fi, battery) — Windows' notification area can't be enumerated reliably, so "Choose which icons show" opens Windows Settings.
- **Settings rebuilt like the reference.** Left sidebar (General, Accessibility, Appearance, Island, Taskbar, Tabs, Widgets, Calls, Streaming, Gaming, AI agents, Tools, Keys, About), live interactive preview of the real island at the top of Appearance, Corners slider, Surface descriptions + 10 theme buttons (Pure black added), the capture note. When the Glass surface is on, the Settings window itself becomes glass (image-33); with a normal surface it is opaque dark (image-34). Glass/Candy glass use `WDA_EXCLUDEFROMCAPTURE` while active so they don't appear in screenshots/recordings, and fall back to plain glass while OBS is recording/streaming.
- **AI agents section: research only.** An AI-agents section shows what coding agents (Claude Code, Codex, Antigravity, Hermes, or your own) are doing and nudges when one needs you (e.g. waiting for a permission). Not built in OpenIsland — PJ decides later.

> Future candidates (not in this release): direct login-and-play inside the island for Spotify / YouTube Music / Apple Music. Spotify in-island playback needs the Web Playback SDK, which needs Spotify Premium plus a Spotify developer app you create; YouTube Music has no official playback API; Apple Music needs a paid Apple Developer MusicKit token. SMTC multi-session already covers "anything playing on the PC" with no login at all.

## Install & update — one file does both

Each release ships its full files on GitHub Releases — one release per version
(https://github.com/name-is-pj/open-island/releases), each carrying its full
installer + portable zip, so any version can be downloaded in full.

- **Installer (recommended):** download `OpenIsland-Setup-1.0.0.exe`,
  double-click, Next, Finish. It installs to `C:\Program Files\OpenIsland`,
  adds Start Menu and desktop shortcuts, and an uninstaller in Add/Remove
  Programs. To update later, just run the newer installer over it — your
  settings are kept. (Unsigned: on first run Windows SmartScreen may ask —
  "More info" → "Run anyway".)
- **Portable (no install):** download `OpenIsland-v1.0.0-win-portable.zip`,
  unzip anywhere, run `OpenIsland.exe`. To update later, unzip the newer
  version OVER the existing app folder, replacing the files, then run
  `OpenIsland.exe`.

Your settings, clipboard history, file shelf and reminders all carry over —
they live in `%APPDATA%\openisland` (the app's userData folder), outside the
app folder, so replacing the app files or installing over never touches them.
The version in Settings → About confirms the update.

## Run it (Windows)

Download the installer from GitHub Releases (link above), double-click, Next,
Finish — or unzip the portable zip and run `OpenIsland.exe`. To run from source:

```bat
npm install
npm start
```

Portable Windows build (no installer, no Wine/NSIS — see below):

```bat
npm run build:win
```

Output: `release\win-unpacked\OpenIsland.exe` — copy that folder anywhere and run it.
Unsigned build (the exe is not code-signed). Then `npm run icon:exe` embeds the
neon icon into the exe (7 sizes, pure-JS PE step, no Wine), and the NSIS
installer is built with native makensis on Linux:

```bat
makensis -DSRC_DIR=<abs path to release/win-unpacked> -DOUTDIR=<abs path to release notes folder> -DICON_PATH=<abs path to assets/icon.ico> installer/open-island.nsi
```

> Build note: `npm run build:win` on Linux fails at the code-signing step
> ("wine is required") — signing needs Wine. The portable app itself builds
> fine unsigned with `npx electron-builder --win --dir -c.win.signAndEditExecutable=false`.
> On a Windows machine, plain `npm run build:win` works and signs if a cert is configured.

## What works in v2

| Feature | Status |
|---|---|
| Top-centre island: floating pill or notch, any size, top-left/centre/right | ✅ |
| Hover opens, mouse-leave closes, Ctrl+Alt+N toggles, click-through when collapsed | ✅ |
| Hidden-until-pointer-rests-on-top-edge mode + open delay | ✅ (setting; edge detection wired to hover) |
| Per-app rules (show / hide / strip / step-aside per exe) | ✅ enforced live by the foreground-app watcher (PowerShell/user32, ~500ms) |
| Now playing: title/artist, play/pause/skip, progress | ✅ via Windows SMTC `GetSessions()` — every playing app, one card each; in-app player for local audio files; **no media = "No media playing", honestly** |
| Lyrics drawer (LRCLIB, cover colours, current line highlighted, click-to-jump) | ✅ — **off by default**; when off, nothing about music leaves the PC |
| Widgets: clock 12/24h, weather (Open-Meteo, free, no key, default Hyderabad), CPU/GPU/RAM, focus timer, to-do | ✅ |
| Quick controls: volume, brightness, Wi-Fi, Bluetooth, Night Light, Focus | ⚠️ Partial — see "Windows helpers" below |
| Clipboard history: text/links, pin, click-to-copy, delete, persisted | ✅ — encrypted for the Windows account via Electron `safeStorage` on Windows |
| File shelf: drop files, drag back out, Send to Phone via QR (two-way: phone → PC too) | ✅ |
| Reminders: seconds/minutes, snooze/done, pop up over fullscreen | ✅ |
| Calls: Ctrl+Alt+M mic mute, call timer while mic is in use, privacy dot, mic/speaker selectors, camera mirror (camera on ONLY while Preview is pressed) | ⚠️ Mic mute is v1-partial (Core Audio COM shim in `mic-mute.ps1` — untested on real Windows; failure is reported, never faked) |
| Game strip: slim CPU/GPU/RAM/FPS strip, step-aside / hide modes | ✅ — **real FPS** from Windows frame events (DWM composition rate, nothing injected; borderless/windowed fullscreen only; one-time in-app consent). Toggle in Settings → Gaming destroys the strip window when off; top-left / top-right position |
| Desktop widgets: day-clock (THURSDAY / date / time), weather, stats | ✅ — the day-clock is explicitly tested to render (a v0.5.104 lesson) |
| Themes: Liquid Glass, Black, Pure black, Graphite, Acrylic, Candy Glass, Rosé, Lavender, Peach, Sakura; corner-radius slider; accent colour; see-through surface slider | ✅ — 10 themes, each a real glass treatment with live preview swatches |
| Settings window: General, Accessibility, Appearance, Island, Taskbar, Tabs, Widgets, Calls, Streaming, Gaming, AI agents, Tools, Keys, About | ✅ — sidebar layout, live interactive island preview at the top of Appearance, **no Save button: every change applies live** |
| Tray icon + first-run tour (once only) | ✅ — tour is a small hint card inside the expanded island, never a full overlay; single-instance lock |
| Screenshot (desktopCapturer), region snip, screen record to webm | ✅ — screenshot to Pictures + clipboard; region snip (drag a region, PNG to Pictures + clipboard); screen recording to webm in Videos |
| PC Deck (phone trackpad / music / apps / game-slide-movie modes, QR, browser-only, no phone app) | ✅ — Deck tab + LAN server + QR; **trackpad movement works** (finger deltas move the PC cursor, tap = click) |
| Taskbar (optional, OFF by default): bottom notch, Start, pinned/open apps, song+timer, tray, quick settings, clock; steps aside for games; maximised windows get the whole screen; show-desktop button at far right | ✅ — one switch in Settings → Taskbar; Mac-style minimise animation into the dock icon; hides the Windows taskbar (restored on toggle-off/quit); auto-hide while the island is on a side |
| Streaming: Twitch/YouTube chat drawer, OBS REC/LIVE pill (elapsed time + scene + start/stop keys via OBS Studio's own WebSocket server), render-folder watch | ✅ — chat drawers open the web chat; OBS pill wired via `obs-websocket-js` (off by default, honest "not connected"); render-folder watch surfaces new files in the Stream tab |
| Scripts / live tiles: any local program can put a line on the island via localhost-only HTTP or CLI | ✅ `POST http://127.0.0.1:8178/notify {"text":"build done"}` or `node cli.js notify "build done"` — localhost only, never LAN |
| 6 favourite-app slots with hotkeys that work from fullscreen games | ✅ — pick an app per slot in Settings → Keys, global hotkey launches it; slots show in the Controls tab |
| Mirrored Windows notifications in one on-PC list | ✅ — Notifications tab, after Windows permission; honest empty state when denied; app's own notifications listed too; nothing leaves the PC |
| Colour picker Ctrl+Alt+C | ⚠️ v1 samples the screen centre; pointer-position sampling needs a native helper (v2) — **not done in V2** (see below) |

## Windows helpers — honest status

Helpers live in `src/helpers/win/*.ps1` and run **only on Windows** (PowerShell,
`-ExecutionPolicy Bypass`, current process only). On Linux they return
"Windows-only helper" and the UI says so instead of faking a value.

| Helper | Status on real Windows |
|---|---|
| `media.ps1` / `media-control.ps1` (SMTC) | Expected working — WinRT SMTC API |
| `brightness.ps1` (WMI) | Expected working |
| `gpu.ps1` (perf counters) | Expected working; falls back to name-only |
| `taskbar.ps1` (hide/show + status) | Expected working; restores on quit; **v5 verifies every hide/show** (IsWindowVisible after the call) and Settings → Taskbar shows the verified state |
| `mic-mute.ps1` (Core Audio COM shim) | **Unverified** — needs a Windows machine to test; failure is surfaced, never faked |
| `volume.ps1` | Core Audio COM shim (MMDeviceEnumerator + IAudioEndpointVolume); **v5 runs the COM calls on an STA thread** with an MTA fallback — get/set return honest errors, never fake numbers; on-Windows execution is PJ-verified |
| `nightlight.ps1` / `focus.ps1` | **v5 fixed** — Night Light reads/flips the CloudStore `bluelightreduction` blob (byte 24) with verification; Focus reads/writes `NOC_GLOBAL_SETTING_TOASTS_ENABLED` (0 = Do Not Disturb on) with verification. If the programmatic toggle cannot work on a machine, the tile opens the matching Windows Settings page instead of being a dead button |
| `net-toggle.ps1` | Wi-Fi via WinRT Radios ✅ (verified after the toggle) with a `netsh` fallback using the real interface name; Bluetooth via WinRT Radios — expected working |
| `privacy.ps1` | Best-effort (camera/capture process detection); mic detection is a stub — the call timer only starts when Windows reports mic use |
| `fps.ps1` (DWM composition rate) | New in v2 — `DwmFlush()` sampling; idle compositor returns null (honest "—"); verified to parse, Windows measurement is PJ-verified |
| `notifications.ps1` (WinRT UserNotificationListener) | New in v2 — needs package identity (MSIX); an unpackaged portable app gets AccessDenied, shown honestly; app's own notifications still mirrored |
| `windows.ps1` (list/focus/minimize/restore/show-desktop/start-menu/move/click) | New in v2 — user32 + Shell.Application; parse-checked, Windows behaviour PJ-verified |
| `power.ps1` / `power-mode.ps1` (powercfg) | New in v2 — parse-checked |
| `netstat.ps1` (network rates) | New in v2 — perf counters; parse-checked |
| `audio-devices.ps1` (headphone connect/disconnect) | New in v2 — `Get-PnpDevice -Class AudioEndpoint`; headphone battery has no stable Win32/PowerShell API, so it is not shown |
| `wallpaper-attach.ps1` (Progman/WorkerW) | New in v2 — Progman/WorkerW embedding; parse-checked, attach on real Windows is PJ-verified |
| `net-state.ps1` (Wi-Fi/Bluetooth/Night Light) | New in v2 — parse-checked; **v5: Wi-Fi reads the WinRT radio first** with a multi-interface `netsh` fallback (connected if ANY interface is connected); Night Light searches all CloudStore keys for the blob |
| `workarea.ps1` (SPI_GETWORKAREA/SPI_SETWORKAREA) | New in v2 — reserves the bottom edge for the dock, restores on quit; parse-checked |
| `affinity.ps1` (SetWindowDisplayAffinity) | New in v2 — WDA_EXCLUDEFROMCAPTURE for Glass surfaces; parse-checked |

**None of these were testable on the Linux dev box.** They must be verified on
PJ's Windows laptop before being called "working".

## Footprint — how to measure ours

Target (same bar as the paid app): ~13 MB RAM, 0% CPU at idle.
Polling is cheap on purpose: clipboard 1/s, media 2/s, stats 2/s, privacy 5/s;
the renderer only re-renders on change. Measure on Windows with:

```powershell
# while OpenIsland is idle in the tray
Get-Process OpenIsland | Select-Object Name, WorkingSet64, CPU
# or: Task Manager → Details → OpenIsland → Memory / CPU
```

If idle CPU is above ~0–1% or RAM is far above ~50 MB (Electron baseline),
that is a bug — file it with the numbers above.

## Startup robustness (a v0.5.104 lesson)

- If the app cannot start, it must show a clear message saying why — never a
  silent fail, never a fake success. On PCs whose graphics chip lacks DirectX 12
  support, Electron falls back to software rendering (`--disable-gpu` path is
  honoured by Chromium) instead of playing an error sound and not opening.
- If a Windows helper fails, the UI shows the error text, not a made-up value.

## Scripts / CLI

```bash
node cli.js notify "build done"        # puts a line on the island (localhost only)
curl -X POST http://127.0.0.1:8178/notify -d '{"text":"build done"}'
```

## Permissions (what each one is actually for)

- **Mic** — call timer / mute + voice in recordings *if* recording-with-mic is on.
- **Webcam** — mirror only, only when Preview is pressed; released when the tab closes.
- **Location** — weather only, and only if "Use my location" is chosen.
- **Notifications** — read only, only after Windows permission; mirrored notifications never leave the PC.
- **Lyrics** — when on, one LRCLIB lookup per song sends only title/artist/album/length. When off, nothing about music leaves the PC. Music videos are skipped.

## Out of scope for v2 (deliberate)

- **21 languages** — v2 is English only; strings are structured for i18n later. We do not claim 21 languages.
- **Direct streaming logins** — login-and-play inside the island for Spotify / YouTube Music / Apple Music is post-V2. Spotify needs the Web Playback SDK + Premium + a Spotify developer app the user creates; YouTube Music has no official playback API; Apple Music needs a paid Apple Developer MusicKit token. SMTC multi-session already covers "anything playing on the PC" with no login.
- **AI features** — the Settings sidebar has an AI-agents section that explains what such a section does (research only); no AI features are built.
- **Colour picker at the pointer** — Ctrl+Alt+C still samples the screen centre; pointer-position sampling needs a native helper and was not done in V2.

## Project layout

```
app/
  package.json            npm start / npm run build:win (electron-builder --win --dir, portable)
  cli.js                  localhost CLI: openisland notify "..."
  src/main.js             windows, tray, hotkeys, clipboard, media, servers
  src/preload.js          context-isolated bridge
  src/renderer/           index.html + app.js (island), settings.html, widget.html,
                          gamestrip.html, reminder.html, styles.css
  src/helpers/win/*.ps1   Windows-only PowerShell helpers (see table above)
  assets/                 icon.png, icon.ico, tray.png — neon Open Island artwork
```

## Licence

MIT. Original code; no third-party app branding, assets or code.

Questions? Reach out to us at pjdevelopers9536@gmail.com.
