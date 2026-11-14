// OpenIsland island renderer — tabs, media, widgets, clipboard, shelf, reminders, calls.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let S = null, collapsed = true, stats = null;
let focusTimer = null, focusLeft = 0, lyricsLines = [], lyricsTimer = null;

const toast = (t) => { const el = $('#toast'); el.textContent = t; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 2500); };
const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
// SVG icons only — zero emojis in the island UI (item 13). icons.js is
// loaded at the start of <body> and exposes window.OIIcons.icon().
const icon = (name, cls) => (window.OIIcons ? window.OIIcons.icon(name, cls || 'oi-ic') : '');

// --- dynamic sizing (item 3): height = content only, one expanded width.
// The main process owns the window; Worker B adds preload resizeIsland +
// the main handler with clamping. We measure the expanded content
// (tab strip + tour if visible + full #body scrollHeight) and report it
// after every tab switch and content change. Guarded: until Worker B
// lands, resizeIsland is simply absent and nothing breaks.
// window.__oiLastResizeH exposes the last reported height for tests.
let __oiResizeRaf = 0;
function requestIslandResize() {
  if (__oiResizeRaf) return;
  __oiResizeRaf = requestAnimationFrame(() => {
    __oiResizeRaf = 0;
    try {
      if (collapsed) return;
      const ex = $('#expanded');
      if (!ex) return;
      const tabsH = $('#tabs') ? $('#tabs').offsetHeight : 0;
      // Measure the ACTIVE PANEL's content height, not #body.scrollHeight:
      // scrollHeight of a scroll container is floored at its own viewport
      // height, so while the window is still tall it reports the window
      // height and the window can never shrink to fit short content
      // (v300-a round 1: music stuck at 412px with ~80px of empty space).
      // The panel is a plain block child, so its scrollHeight IS its
      // content height. +26 = #body's own top+bottom padding.
      const panel = document.querySelector('.panel.active');
      const contentH = panel ? panel.scrollHeight : ($('#body') ? $('#body').scrollHeight : 0);
      // +26 = #body's own top+bottom padding; +8 safety for sub-pixel
      // rounding (a clipped last line is worse than 8px of air).
      const h = Math.ceil(tabsH + contentH + 26) + 6 + 8; // +6: 3px frame ring, top + bottom
      const clamped = Math.max(120, Math.min(820, h));
      window.__oiLastResizeH = clamped;
      if (typeof window.openisland?.resizeIsland === 'function') window.openisland.resizeIsland(clamped);
    } catch (e) { /* sizing must never break the island */ }
  });
}

// v1.0.0: the first-run tour is a separate modal dialog (tour.html,
// opened by main on first run). The island never carries a tour banner.
function applySettingsToIsland() {
  if (!S) return;
  document.documentElement.dataset.theme = S.appearance.theme;
  document.documentElement.style.setProperty('--accent', S.appearance.accent);
  document.documentElement.style.setProperty('--radius', S.appearance.cornerRadius + 'px');
  document.documentElement.style.setProperty('--surface', String(S.appearance.surface ?? 100));
  document.documentElement.style.setProperty('--blur', 'blur(' + ((S.appearance.blurPct == null ? 100 : S.appearance.blurPct) * 0.28) + 'px) saturate(1.6)');
  document.documentElement.classList.toggle('reduce-motion', !!S.accessibility?.reduceMotion);
  document.documentElement.classList.toggle('larger-text', !!S.accessibility?.largerText);
  // Visualizer (item 15): 'pixels' (default) = square bars, 'bars' = smooth
  // rounded bars in the pill waveform. Applied live on settings change.
  document.documentElement.dataset.visualizer = S.appearance.visualizer || 'pixels';
  document.body.classList.toggle('notch', S.island.shape === 'notch');
  applyTabs();
  requestIslandResize();
}
function applyTabs() {
  // Customizable tabs (v2.0.0): the island shows only enabled tabs; the last
  // enabled tab can never be turned off (Settings enforces it).
  const panels = S.panels || {};
  let activeOk = false;
  $$('#tabs button[data-tab]').forEach(b => {
    const on = panels[b.dataset.tab] !== false;
    b.style.display = on ? '' : 'none';
    if (on && b.classList.contains('active')) activeOk = true;
  });
  // v1.0.0: strip icons without a data-tab (the headphones icon shares the
  // Controls panel) follow their panel via data-panel.
  $$('#tabs button[data-panel]').forEach(b => {
    b.style.display = panels[b.dataset.panel] !== false ? '' : 'none';
  });
  if (!activeOk) {
    const first = $$('#tabs button[data-tab]').find(b => panels[b.dataset.tab] !== false);
    if (first) switchTab(first.dataset.tab);
  }
}
// v1.0.0: the theme cycler button is gone from the strip (the reference has
// no theme button there) — themes change in Settings → Appearance only.
// THEMES/cycleTheme removed; the THEMES list lives in settings.html now.
async function init() {
  S = await window.openisland.getSettings();
  applySettingsToIsland();
  // Feature A (v2.0.0): border wallpaper — theme-independent, lives only in the frame ring.
  const bw = await window.openisland.getBorderWallpaper();
  document.documentElement.style.setProperty('--border-img', bw.css || 'none');
  window.openisland.on('border-wallpaper', (v) => document.documentElement.style.setProperty('--border-img', v.css || 'none'));
  window.openisland.on('settings-updated', (ns) => { S = ns; applySettingsToIsland(); syncGamingControls(); renderFavourites(); renderWeb(); renderNotifications(); requestIslandResize(); });
  window.openisland.on('switch-tab', (tab) => switchTab(tab));
  window.openisland.on('obs-updated', (st) => { renderObs(st); document.documentElement.classList.toggle('obs-live', !!(st.recording || st.streaming)); });
  window.openisland.on('render-updated', (r) => renderRenderWatch(r));
  window.openisland.on('notifications-updated', () => renderNotifications());
  $('#gameMode').value = S.gaming.mode;
  syncGamingControls();
  $('#deckSw').classList.toggle('on', !!S.deck.enabled);
  $('#streamSw').classList.toggle('on', !!S.streaming.enabled);
  $('#twitchCh').value = S.streaming.twitchChannel || '';
  $('#ytUrl').value = S.streaming.youtubeUrl || '';
  $('#ovLyrics').style.display = S.lyrics.enabled ? '' : 'none';
  renderFavourites(); renderWeb(); renderNotifications(); renderObs(await window.openisland.obsStatus());
  refreshClip(); refreshShelf(); refreshReminders(); refreshWeather(); refreshMic(); tickClock(); pollMedia(); refreshNetwork();
  setInterval(tickClock, 1000);
  setInterval(refreshWeather, 10 * 60 * 1000);
  setInterval(refreshNetwork, 5000);
  window.openisland.on('island-state', ({ collapsed: c }) => {
    collapsed = c; document.body.classList.toggle('expanded', !c);
    // v1.0.2: the overflow (•••) menu must close WITH the island. Before
    // this, closeOverflow ran only on an outside click or a menu-item
    // click, so the menu's .open class survived a collapse and the menu
    // was still open (Clipboard / Reminders / Gaming / …) the next time
    // the island expanded — PJ: "why other icons are still showing".
    if (c) closeOverflow();
    if (!c) { // default tab on open (f-07): Last tab vs Music
      const t = S.island.openTab === 'music' ? 'music' : (localStorage.getItem('oi-last-tab') || 'music');
      if ((S.panels || {})[t] !== false) switchTab(t);
      requestIslandResize();
    }
  });
  window.openisland.on('stats-updated', (s) => { stats = s; renderStats(); });
  window.openisland.on('clipboard-updated', (list) => renderClip(list));
  window.openisland.on('shelf-updated', (list) => renderShelf(list));
  window.openisland.on('reminders-updated', (list) => renderReminders(list));
  window.openisland.on('media-updated', (m) => renderMedia(m));
  window.openisland.on('mic-state', (muted) => { $('#micSw').classList.toggle('on', muted); $('#micStateText').textContent = muted ? 'Muted' : 'Live'; });
  window.openisland.on('privacy-updated', ({ micInUse, camInUse, captureInUse, callSeconds }) => {
    $('#privacyDot').classList.toggle('on', !!(micInUse || camInUse || captureInUse));
    // The idle pill never shows text (item 19) — the red privacy dot is
    // the only call indicator; the call timer is not rendered in the pill.
  });
  window.openisland.on('script-notify', (text) => toast('Script: ' + text));
  window.openisland.on('color-pick-request', async () => { const r = await window.openisland.colorPick(); if (r.ok) toast('Colour copied: ' + r.hex); else toast('Colour pick unavailable'); });
  // hover expand / mouse-leave collapse — both are only fast paths now;
  // the main-process cursor poll (150ms) is the authority that opens the
  // island when the pointer rests on the pill and closes it when it leaves,
  // because :hover can't be trusted on a transparent frameless window.
  const isl = $('#island');
  isl.addEventListener('mouseenter', () => { if (collapsed) window.openisland.expandHover(); });
  isl.addEventListener('mouseleave', () => { if (!collapsed) setTimeout(() => { if (!isl.matches(':hover')) window.openisland.collapse(); }, 250); });
  $('#collapsed').addEventListener('click', () => window.openisland.expand());
  $('#settingsBtn').addEventListener('click', () => window.openisland.openSettings());
  // v1.0.0: profile (account) icon opens Settings at About; the headphones
  // icon opens Controls (the reference never shows its panel, so by analogy
  // it shares the Controls panel — see the v6 evidence notes).
  $('#profileBtn').addEventListener('click', () => window.openisland.openSettings('about'));
  $('#headphonesBtn').addEventListener('click', () => switchTab('controls'));
  // v1.0.0: overflow (•••) menu — panels without a strip icon + the actions
  // that used to fill the panels. Clicking a panel item switches to it and
  // closes the menu; the menu also closes on any outside click.
  const ovMenu = $('#overflowMenu');
  const closeOverflow = () => ovMenu.classList.remove('open');
  $('#moreBtn').addEventListener('click', (e) => { e.stopPropagation(); ovMenu.classList.toggle('open'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#overflowMenu') && !e.target.closest('#moreBtn')) closeOverflow(); });
  ovMenu.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) { switchTab(b.dataset.tab); closeOverflow(); } });
  // Feature B (v2.0.0): hold-Ctrl click-through — forwarded mousemove events
  // carry event.ctrlKey even while the window ignores mouse events, so the
  // renderer can tell main when Ctrl is held and the island should go live.
  let ctrlHeldLocal = false;
  const reportCtrl = (held) => { if (held !== ctrlHeldLocal) { ctrlHeldLocal = held; window.openisland.ctrlState(held); } };
  document.addEventListener('mousemove', (e) => reportCtrl(!!e.ctrlKey));
  document.addEventListener('keydown', (e) => { if (e.key === 'Control') reportCtrl(true); });
  document.addEventListener('keyup', (e) => { if (e.key === 'Control') reportCtrl(!!e.ctrlKey); });
  $$('#tabs button[data-tab]').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
    // v1.0.0 (item A, PJ 2026-11-14): hovering an icon SWITCHES to that
    // panel immediately — "Why I have to click on icons? It should show
    // where the mouse is pointing right?" This OVERRIDES the v5.0.0 item B3
    // rule (hover highlights only, click switches) and the video study's
    // reading of it. Click keeps working too. The hovered icon still
    // highlights (CSS :hover); switching is a plain class toggle, so
    // sweeping the pointer across the strip switches without flicker.
    b.addEventListener('mouseenter', () => switchTab(b.dataset.tab));
  });
  $('#headphonesBtn').addEventListener('mouseenter', () => switchTab('controls'));
  // Tab strip (item 1): a vertical wheel over the strip scrolls it
  // horizontally, so tabs past the edge are reachable without dragging.
  const tabbar = $('#tabs .tabbar');
  if (tabbar) tabbar.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); tabbar.scrollLeft += e.deltaY; }
  }, { passive: false });
  // Dynamic sizing (item 3): any content change inside #body re-measures.
  // Debounced inside requestIslandResize; it never mutates the DOM, so
  // this cannot loop.
  new MutationObserver(() => requestIslandResize()).observe($('#body'), { childList: true, subtree: true, characterData: true });
  // The Inter webfont loads async; text re-wraps once it arrives, which
  // can add a line after the first measurement — re-measure then.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestIslandResize());
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
}
function syncGamingControls() {
  $('#stripSw').classList.toggle('on', S.gaming.showStrip !== false);
  $('#stripPos').value = S.gaming.stripPosition || 'top-left';
  $('#slimStripSw').classList.toggle('on', !!S.gaming.slimStripMaximized);
  $('#fpsConsentBox').style.display = S.gaming.fpsConsent === 'unset' ? '' : 'none';
}
function switchTab(name) {
  // v1.0.2: switching panels closes the overflow (•••) menu — the menu
  // must never survive a panel switch or a fresh expand. (switchTab is
  // top-level, so it closes the menu via the DOM, not the init-local
  // closeOverflow; the island-state handler calls closeOverflow directly.)
  document.querySelector('#overflowMenu')?.classList.remove('open');
  $$('#tabs button[data-tab]').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    // Item F (v3.0.1): NO scrollIntoView — the strip never scrolls now
    // (tabbar flex:0 1 auto, overflow visible), so every icon is always
    // fully visible; the old scroll call is what clipped the first icon.
  });
  // v1.0.0: the headphones icon shares the Controls panel — light it too.
  $$('#tabs button[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  localStorage.setItem('oi-last-tab', name);
  if (name !== 'calls') stopCamera();
  if (name === 'clipboard') refreshClip();
  if (name === 'files') refreshShelf();
  if (name === 'reminders') refreshReminders();
  if (name === 'controls') { refreshControls(); renderFavourites(); }
  if (name === 'widgets') { refreshWeather(); refreshNetwork(); }
  if (name === 'stream') renderObs(null);
  if (name === 'web') renderWeb();
  if (name === 'notifications') renderNotifications();
  requestIslandResize();
}
let mediaPlaying = false, hasMusicSession = false;
function tickClock() {
  const now = new Date();
  // Idle pill (item 19): NO text ever — no clock, no media title. The red
  // waveform (#eq) is the only playing indicator, and it animates only
  // while something is actually playing (renderMedia toggles .playing).
  renderWeekStrip(now);
  if (focusTimer) {
    focusLeft--;
    updateFocusUI();
    if (focusLeft <= 0) { clearInterval(focusTimer); focusTimer = null; $('#focusLabel').textContent = 'Done — nice focus!'; toast('Focus timer done'); }
  }
}
function renderWeekStrip(now) {
  // v1.0.0: the date sub-card shows the big day number + "THU NOV" + the
  // week number, and the strip is just S..S with today in a white circle.
  const start = new Date(now); start.setDate(now.getDate() - now.getDay());
  const week = Math.ceil((((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7);
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const dn = $('#wDayNum'); if (dn) dn.textContent = String(now.getDate());
  const wm = $('#wMon'); if (wm) wm.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short' }).toUpperCase();
  const ww = $('#wWeek'); if (ww) ww.textContent = 'Week ' + week;
  $('#weekStrip').innerHTML = days.map((d, i) => {
    const dt = new Date(start); dt.setDate(start.getDate() + i);
    return `<span class="wk${dt.toDateString() === now.toDateString() ? ' today' : ''}" title="${dt.toDateString()}">${d}<b>${dt.getDate()}</b></span>`;
  }).join('');
}
const WEATHER_TEXT = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 61: 'Slight rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Slight snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Slight showers', 81: 'Showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Storm + hail' };
async function refreshWeather() {
  const r = await window.openisland.weather();
  // v1.0.0: a failed weather fetch shows a muted "—", never a full error
  // sentence — the card stays clean.
  if (!r.ok) { $('#weatherBox').innerHTML = `<div class="wtemp">—</div><div class="wcond muted">Weather unavailable</div>`; return; }
  const d = r.data;
  const daily = r.daily || {};
  const cond = WEATHER_TEXT[d.weather_code] || ('Code ' + d.weather_code);
  $('#weatherBox').innerHTML = `<div style="display:flex;align-items:center;gap:10px"><div class="wtemp">${Math.round(d.temperature_2m)}°</div><span class="wicon">${icon('sun')}</span></div><div class="wcond">${cond}</div><div class="whl">H ${daily.max != null ? Math.round(daily.max) + '°' : '—'} L ${daily.min != null ? Math.round(daily.min) + '°' : '—'}</div>`;
}
function barRow(label, pct, extra, cls) {
  // v1.0.0: CPU/RAM are never "—" — a missing value is 0%. GPU shows "—"
  // only when the getter honestly has no value.
  const p = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  return `<div class="barrow"><span class="barlabel">${label}</span><div class="bar"><i class="${cls || ''}" style="width:${p}%"></i></div><span class="barval">${pct == null ? '—' : pct + '%'}</span>${extra || ''}</div>`;
}
function renderStats() {
  if (!stats) return;
  const gpu = stats.gpu || {};
  $('#statsBars').innerHTML =
    barRow('CPU', stats.cpu ?? 0, '', 'bar-cpu') +
    barRow('GPU', gpu.load, gpu.temp != null ? `<span class="muted small">${gpu.temp}°</span>` : '', 'bar-gpu') +
    barRow('RAM', stats.mem.usedPct ?? 0, '', 'bar-ram');
  // v1.0.0: the widgets card shows just "FPS —" when no game is
  // presenting — no explanation paragraph.
  $('#fpsNote').textContent = stats.fps == null ? 'FPS —' : 'FPS ' + Math.round(stats.fps);
  $('#gCpu').textContent = stats.cpu == null ? '—' : stats.cpu + '%';
  $('#gRam').textContent = stats.mem.usedPct + '%';
  // GPU (item 17): the real GPU % from get-stats — shown in the Widgets PC
  // stats bars above and in the Gaming live strip preview below. '—' only
  // when the getter honestly has no value (no GPU / no counter).
  $('#gGpu').textContent = gpu.load == null ? '—' : gpu.load + '%';
  // Real FPS (v2.0.0): stats.fps is a measured DWM composition rate, or null
  // when no game is presenting / consent is off — never a fake number.
  $('#gFps').textContent = stats.fps == null ? '—' : Math.round(stats.fps) + ' fps';
  requestIslandResize();
}
async function refreshNetwork() {
  const r = await window.openisland.getNetwork().catch(() => ({ ok: false }));
  if (!r || !r.ok) { $('#netDown').textContent = '—'; $('#netUp').textContent = '—'; return; }
  const fmtB = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB/s' : b >= 1024 ? (b / 1024).toFixed(0) + ' KB/s' : b + ' B/s';
  $('#netDown').textContent = fmtB(r.down);
  $('#netUp').textContent = fmtB(r.up);
}
// --- focus timer (image-30: circular 25:00, play/−/+, 25/15/5) ---
let focusTotal = 25 * 60;
function updateFocusUI() {
  $('#focusTime').textContent = fmt(focusLeft);
  const ring = $('#focusRing');
  if (ring) ring.style.strokeDashoffset = String(2 * Math.PI * 44 * (1 - (focusTotal ? focusLeft / focusTotal : 0)));
  $('#focusLabel').textContent = `${Math.round(focusTotal / 60)} + 5 min`;
}
function setFocus(mins) { focusTotal = mins * 60; focusLeft = focusTotal; clearInterval(focusTimer); focusTimer = null; updateFocusUI(); }
// --- music carousel (v2.0.0: one card per SMTC session, swipe between apps) ---
// Rebuilds the cards only when the SET of sessions changes (ids); otherwise
// it updates the visible card in place so a 2s poll never resets a swipe.
// Wavy progress (item 25): a sine-wave SVG path. The base wave is muted;
// an identical red wave clipped to the played fraction sits on top, with
// a handle dot at its end. Clicking the wave seeks (item 25).
const WAVE_CYCLES = 14;
function wavePath() {
  const pts = [];
  for (let x = 0; x <= 600; x += 5) {
    const y = (12 + 5.5 * Math.sin((x / 600) * Math.PI * 2 * WAVE_CYCLES)).toFixed(1);
    pts.push((x === 0 ? 'M0 ' : 'L' + x + ' ') + y);
  }
  return pts.join(' ');
}
function waveYAt(frac) { return 12 + 5.5 * Math.sin(frac * Math.PI * 2 * WAVE_CYCLES); }
function musicCardHtml(s, i) {
  // Reference layout (f-11/f-26, image-55, v1.0.0): album art ~98px with a
  // small pink music-note badge bottom-right, title bold ~20px + artist
  // below, prev/pause/next to the right as clean .tbtn icons, wavy red
  // progress under it with a white playhead tick and a thin straight
  // remaining line, elapsed bottom-left / -remaining bottom-right.
  const art = s.artwork
    ? `<img class="mart" src="${s.artwork}" alt="">`
    : `<div class="mart art">${icon('music')}</div>`;
  const playing = s.status === 'playing';
  const frac = s.duration ? Math.min(1, Math.max(0, s.position / s.duration)) : 0;
  const remaining = s.duration ? Math.max(0, s.duration - s.position) : 0;
  const wx = Math.round(600 * frac);
  const wave = wavePath();
  const sid = escHtml(s.id);
  return `<div class="mcard" data-sid="${sid}"><div class="mrow"><div class="mart-wrap">${art}<span class="mart-badge">${icon('music')}</span></div>
    <div class="mmeta">
      <div class="mtitle">${escHtml(s.title)}</div>
      <div class="muted small martist" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml([s.artist, s.album].filter(Boolean).join(' — ') || 'Unknown artist')}</div>
      <div class="muted small mvia">via ${escHtml(s.app)}${playing ? ' · playing' : ''}</div>
    </div>
    <div class="mctl">
      <button class="tbtn m-prev" data-sid="${sid}" title="Previous">${icon('skip-back')}</button>
      <button class="tbtn main m-play" data-sid="${sid}" title="${playing ? 'Pause' : 'Play'}">${icon(playing ? 'pause' : 'play')}</button>
      <button class="tbtn m-next" data-sid="${sid}" title="Next">${icon('skip-forward')}</button>
    </div></div>
    <div class="wavy" data-seek title="Click to seek"><svg viewBox="0 0 600 24" preserveAspectRatio="none" aria-hidden="true"><defs><clipPath id="wclip-${i}"><rect x="0" y="0" width="${wx}" height="24"/></clipPath></defs><line x1="0" y1="12" x2="600" y2="12" stroke="rgba(255,255,255,.25)" stroke-width="1.5"/><path d="${wave}" fill="none" stroke="#ff3b30" stroke-width="2" stroke-linecap="round" clip-path="url(#wclip-${i})"/><rect class="wseek" x="${wx - 1}" y="4" width="2.5" height="16" rx="1" fill="#fff"/></svg></div>
    <div class="row small muted mtimes"><span>${fmt(s.position)}</span><span style="flex:1"></span><span>-${fmt(remaining)}</span></div>
  </div>`;
}
function emptyMusicHtml() {
  // v1.0.0: the empty state is ONE short line in the same card — no
  // instructional wall, no chrome://flags hint, no button. It keeps the
  // same layout as the playing card (art row + wave + times) so the card
  // is the same height in both states: the wave is flat at 0% with the
  // white playhead tick at the start, times 0:00 / -0:00. (The helper-
  // error card, errorMusicHtml, is a different card and stays as-is.)
  const wave = wavePath();
  return `<div class="mcard"><div class="mrow"><div class="mart-wrap"><div class="mart art">${icon('music')}</div></div>
    <div class="mmeta">
      <div class="mtitle">No media playing</div>
      <div class="muted small">Play something in any app and it shows here.</div>
    </div></div>
    <div class="wavy"><svg viewBox="0 0 600 24" preserveAspectRatio="none" aria-hidden="true"><defs><clipPath id="wclip-empty"><rect x="0" y="0" width="0" height="24"/></clipPath></defs><line x1="0" y1="12" x2="600" y2="12" stroke="rgba(255,255,255,.25)" stroke-width="1.5"/><path d="${wave}" fill="none" stroke="#ff3b30" stroke-width="2" stroke-linecap="round" clip-path="url(#wclip-empty)"/><rect class="wseek" x="0" y="4" width="2.5" height="16" rx="1" fill="#fff"/></svg></div>
    <div class="row small muted mtimes"><span>0:00</span><span style="flex:1"></span><span>-0:00</span></div></div>`;
}
function errorMusicHtml(err) {
  // getMedia failed at the helper itself: say so honestly, never a fake
  // "No media playing" — and never render the raw helper error (it can
  // contain internal file paths). Detail goes to the console only.
  if (err) console.warn('[openisland] media helper failed:', err);
  return `<div class="mcard"><div class="mrow"><div class="mart art">${icon('alert')}</div>
    <div class="mmeta">
      <div class="mtitle">Media unavailable</div>
      <div class="muted small">Media is unavailable right now.</div>
    </div></div></div>`;
}
// Album-art tint (item 26): sample the artwork down to 32x32 on a canvas
// and tint the card glass with the average colour (CSS var on the card).
// No art / unloadable art / tainted canvas → theme glass, untouched.
let artTintCache = { url: '', tint: '' };
function applyArtTint(card, imgEl) {
  if (!card) return;
  if (!imgEl) { card.style.removeProperty('--art-tint'); return; }
  const url = imgEl.getAttribute('src') || '';
  if (artTintCache.url === url && artTintCache.tint) { card.style.setProperty('--art-tint', artTintCache.tint); return; }
  const extract = () => {
    try {
      if (!imgEl.naturalWidth) return;
      const c = document.createElement('canvas'); c.width = 32; c.height = 32;
      const ctx = c.getContext('2d'); ctx.drawImage(imgEl, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) {
        if (d[i + 3] < 128) continue;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      if (!n) return;
      const tint = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
      artTintCache = { url, tint };
      card.style.setProperty('--art-tint', tint);
    } catch (e) { /* tainted canvas or no art — keep theme glass */ }
  };
  if (imgEl.complete && imgEl.naturalWidth) extract();
  else imgEl.addEventListener('load', extract, { once: true });
  imgEl.addEventListener('error', () => card.style.removeProperty('--art-tint'), { once: true });
}
let musicSig = null, musicIndex = 0, lastMedia = null;
function currentMusicSession() { const s = lastMedia?.sessions || []; return s[musicIndex] || null; }
function escHtml(t) { return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function buildMusicCards(sessions, error) {
  const track = $('#musicTrack');
  if (error) { track.innerHTML = errorMusicHtml(error); }
  else track.innerHTML = sessions.length ? sessions.map(musicCardHtml).join('') : emptyMusicHtml();
  track.style.transform = `translateX(${-musicIndex * 100}%)`;
  bindCardButtons();
  $$('#musicTrack .mcard').forEach((card, i) => applyArtTint(card, card.querySelector('img.mart')));
  requestIslandResize();
}
function updateMusicCard(sessions) {
  const s = sessions[musicIndex];
  if (!s) return;
  const card = $('#musicTrack').children[musicIndex];
  if (!card) return;
  card.querySelector('.mtitle').textContent = s.title;
  card.querySelector('.martist').textContent = [s.artist, s.album].filter(Boolean).join(' — ') || 'Unknown artist';
  card.querySelector('.mvia').textContent = `via ${s.app}${s.status === 'playing' ? ' · playing' : ''}`;
  const playBtn = card.querySelector('.m-play');
  if (playBtn) { playBtn.innerHTML = icon(s.status === 'playing' ? 'pause' : 'play'); playBtn.title = s.status === 'playing' ? 'Pause' : 'Play'; }
  // Wavy progress: move the clip rect + the white playhead tick with playback.
  const frac = s.duration ? Math.min(1, Math.max(0, s.position / s.duration)) : 0;
  const clipRect = card.querySelector('.wavy clipPath rect');
  if (clipRect) clipRect.setAttribute('width', String(Math.round(600 * frac)));
  const tick = card.querySelector('.wavy .wseek');
  if (tick) tick.setAttribute('x', String(Math.round(600 * frac) - 1));
  const times = card.querySelectorAll('.mtimes > span');
  if (times.length >= 2) { times[0].textContent = fmt(s.position); times[times.length - 1].textContent = '-' + fmt(s.duration ? Math.max(0, s.duration - s.position) : 0); }
  const img = card.querySelector('img.mart');
  if (img && img.getAttribute('src') !== (s.artwork || '')) { img.setAttribute('src', s.artwork || ''); applyArtTint(card, img); }
}
function mediaToggle(sid) {
  if (sid === 'inapp') { const p = $('#player'); if (p.src) { p.paused ? p.play() : p.pause(); } return; }
  window.openisland.mediaCommand('toggle', sid).then(() => pollMedia());
}
function bindCardButtons() {
  $$('#musicTrack .m-play').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); mediaToggle(b.dataset.sid); }));
  $$('#musicTrack .m-prev').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const sid = b.dataset.sid;
    if (sid === 'inapp') { const p = $('#player'); if (p.src) p.currentTime = 0; return; }
    await window.openisland.mediaCommand('previous', sid); pollMedia();
  }));
  $$('#musicTrack .m-next').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const sid = b.dataset.sid;
    if (sid === 'inapp') { const p = $('#player'); if (p.src) p.currentTime = 0; return; }
    await window.openisland.mediaCommand('next', sid); pollMedia();
  }));
}
// v1.0.0: the carousel nav row is gone from the panel — swipe still
// switches sessions; goToMusic keeps the transform + in-place update.
function goToMusic(i) {
  const n = (lastMedia?.sessions || []).length;
  if (!n) return;
  musicIndex = Math.max(0, Math.min(n - 1, i));
  $('#musicTrack').style.transform = `translateX(${-musicIndex * 100}%)`;
  updateMusicCard(lastMedia.sessions);
}
async function renderMedia(m) {
  lastMedia = m;
  const sessions = (m && m.sessions) || [];
  hasMusicSession = sessions.length > 0;
  const playing = sessions.find(s => s.status === 'playing');
  mediaPlaying = !!playing;
  // Collapsed pill: the red waveform + grid icon show only while something
  // really plays; the pill never shows text (item 19). CSS drives #eq
  // visibility from the .playing class — no inline style here.
  $('#collapsed').classList.toggle('playing', mediaPlaying);
  // Contract: m.error is a string when the media helper itself failed —
  // show "Media unavailable" + the error, NEVER a fake "No media playing".
  // Sessions empty + error null = the honest empty state (one short line).
  const sig = m && m.error ? 'error:' + m.error : sessions.map(s => s.id).join('|');
  if (sig !== musicSig) {
    musicSig = sig;
    musicIndex = Math.min((m && m.activeIndex) || 0, Math.max(0, sessions.length - 1));
    buildMusicCards(sessions, m && m.error ? m.error : null);
  } else if (!m || !m.error) {
    updateMusicCard(sessions);
  }
  requestIslandResize();
}
async function pollMedia() { renderMedia(await window.openisland.getMedia()); }
setInterval(pollMedia, 2000);

// swipe between sessions: pointer drag (touch + mouse) + arrows + dots
const musicVp = $('#musicViewport');
let dragX = null;
musicVp.addEventListener('pointerdown', (e) => { dragX = e.clientX; });
musicVp.addEventListener('pointerup', (e) => {
  if (dragX == null) return;
  const dx = e.clientX - dragX; dragX = null;
  if (dx < -48) goToMusic(musicIndex + 1);
  else if (dx > 48) goToMusic(musicIndex - 1);
});
musicVp.addEventListener('pointercancel', () => { dragX = null; });
musicVp.addEventListener('click', (e) => { // click the wavy line to seek (item 25)
  const w = e.target.closest('.wavy');
  if (!w) return;
  const s = currentMusicSession();
  if (!s || !s.duration) return;
  const r = w.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const secs = Math.round(frac * s.duration);
  if (s.id === 'inapp') { const p = $('#player'); if (p.src) p.currentTime = secs; return; }
  // Contract: mediaCommand('seek', sessionId, seconds) — Worker B adds
  // seek support with this exact signature; the call is a safe no-op
  // until then (preload drops the extra arg, main ignores unknown seeks).
  if (typeof window.openisland.mediaCommand === 'function') window.openisland.mediaCommand('seek', s.id, secs);
  pollMedia();
});

// --- music controls live on the card itself now (prev/pause/next .tbtn
// buttons, bound in bindCardButtons) — there is no bottom transport row.
$('#ovOpenAudio').addEventListener('click', () => { $('#overflowMenu').classList.remove('open'); $('#audioFile').click(); });
$('#audioFile').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  const p = $('#player'); p.src = URL.createObjectURL(f);
  p.play();
  window.openisland.setInAppMedia({ title: f.name.replace(/\.[^.]+$/, ''), artist: '', album: '', status: 'playing', position: 0, duration: 0 });
});
$('#player').addEventListener('timeupdate', (e) => { const p = e.target; window.openisland.setInAppMedia({ status: p.paused ? 'paused' : 'playing', position: p.currentTime, duration: p.duration || 0 }); });
$('#player').addEventListener('loadedmetadata', (e) => { const p = e.target; window.openisland.setInAppMedia({ duration: p.duration || 0 }); });
$('#ovLyrics').addEventListener('click', async () => {
  $('#overflowMenu').classList.remove('open');
  const m = currentMusicSession();
  if (!m || !m.title) { $('#lyricsStatus').textContent = 'No song playing.'; $('#lyricsBox').style.display = 'block'; return; }
  $('#lyricsBox').style.display = 'block'; $('#lyricsStatus').textContent = 'Looking up lyrics on LRCLIB…';
  const r = await window.openisland.lyricsLookup({ title: m.title, artist: m.artist, album: m.album, duration: m.duration });
  if (!r.ok) { $('#lyricsStatus').textContent = r.error; return; }
  $('#lyricsStatus').textContent = r.synced ? 'Synced lyrics — click a line to jump.' : 'Plain lyrics (no timings).';
  const lines = (r.synced || r.plain || '').split('\n').map(l => {
    const mm = l.match(/^\[(\d+):(\d+\.\d+)\](.*)$/);
    return mm ? { t: +mm[1] * 60 + +mm[2], text: mm[3].trim() } : { t: null, text: l.trim() };
  }).filter(l => l.text);
  lyricsLines = lines;
  $('#lyricsLines').innerHTML = lines.map((l, i) => `<div class="lyric-line" data-i="${i}">${l.text}</div>`).join('');
  $$('#lyricsLines .lyric-line').forEach(el => el.addEventListener('click', () => {
    const p = $('#player'); const line = lyricsLines[+el.dataset.i];
    if (p.src && line.t != null) p.currentTime = line.t;
  }));
  clearInterval(lyricsTimer);
  lyricsTimer = setInterval(() => {
    const p = $('#player'); if (!p.src) return;
    let cur = -1; lyricsLines.forEach((l, i) => { if (l.t != null && l.t <= p.currentTime) cur = i; });
    $$('#lyricsLines .lyric-line').forEach((el, i) => el.classList.toggle('current', i === cur));
    const c = $('#lyricsLines .lyric-line.current'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 500);
});

// --- widgets ---
// v1.0.0: no Lat/Lon inputs (location is a setting in Settings → Widgets),
// no task row (tasks live in the Reminders panel), no Day-clock/Weather/
// Stats toggle row (those are Settings → Widgets toggles). The 12/24h
// clock format lives in Settings → Widgets too.
$('#focusPlay').addEventListener('click', () => {
  if (focusTimer) { clearInterval(focusTimer); focusTimer = null; $('#focusPlay').innerHTML = icon('play'); }
  else { if (focusLeft <= 0) setFocus(25); focusTimer = setInterval(tickClock, 1000); $('#focusPlay').innerHTML = icon('pause'); updateFocusUI(); }
});
$('#focusMinus').addEventListener('click', () => { setFocus(Math.max(5, Math.round(focusTotal / 60) - 5)); });
$('#focusPlus').addEventListener('click', () => { setFocus(Math.min(120, Math.round(focusTotal / 60) + 5)); });
setFocus(25);
// Item E (v3.0.1): the bell sits bottom-centre of the one compact Widgets
// card and opens the Notifications panel.
$('#wBell').addEventListener('click', () => switchTab('notifications'));

// --- controls (image-31/f-12: white vertical sliders, tiles, power row) ---
// Response shapes (src/main.js win-control + getStats):
//   volume-get / brightness-get → { level: number|null } (level null =
//     honestly unknown — the helper could not read it)
//   wifi-get / nightlight-get → { ok: true, on: bool } | { ok: false, error }
//   focus-get → { ok: true, on: bool } | { ok: false, error } (reads the
//     Do Not Disturb registry value on Windows 11; unknown if absent)
//   power-mode-get → { ok: true, mode: 'balanced'|'saver'|'performance'|'unknown' }
//   mic-state → { muted: bool, inUse: bool, ... }
// v1.0.0: tiles and sliders NEVER show "Unavailable" or "—" as a state —
// a failed getter shows the last-known level (sliders) or a word state
// (tiles: Off/On), and a failed toggle opens the matching Windows Settings
// page instead of a dead toast (v5.0.0 item C rule, extended to every tile
// by PJ 2026-11-14: a tile either works or honestly opens Windows Settings).
// Item D (v3.0.1): the sliders are now plain div bars (role="slider"),
// not <input type=range> — the fill height IS the value, no knob. setSlider
// drives the fill <i> and the % label; wireSlider adds pointer drag,
// click-to-set and keyboard support, and on a failed set snaps the bar back
// to the last known good level instead of leaving it at a value that never
// stuck (the brightness "jumps back to 100%" symptom).
const lastLevel = { vol: null, bri: null };
// Item D: the % label sits at the top of the bar and the icon at the bottom,
// ON the fill when it reaches them. The fill is the theme foreground, so the
// label/icon colour flips to the theme background when the fill covers them
// and stays the theme foreground otherwise — measured from the real rects,
// so it is exact in every theme and at every value.
function paintSliderColours(sl) {
  const fill = sl.querySelector('.vbar > i');
  const val = sl.querySelector('.vval'), ico = sl.querySelector('.vico');
  if (!fill || !val || !ico) return;
  const fr = fill.getBoundingClientRect();
  const covers = (r) => fr.height > 0 && r.top >= fr.top - 1 && r.bottom <= fr.bottom + 1;
  val.style.color = covers(val.getBoundingClientRect()) ? 'var(--bg)' : 'var(--fg)';
  ico.style.color = covers(ico.getBoundingClientRect()) ? 'var(--bg)' : 'var(--fg)';
}
function setSlider(sliderSel, valSel, level) {
  const sl = $(sliderSel), val = $(valSel);
  const fill = sl.querySelector('.vbar > i');
  // v1.0.0: an unknown level shows the last-known level, or 100% when
  // nothing is known yet — never "Unavailable", and never a fake number:
  // the label is the level the app last read or set, not a guess.
  if (level == null || Number.isNaN(level)) {
    const last = sliderSel === '#volSlider' ? lastLevel.vol : lastLevel.bri;
    level = last != null ? last : 100;
  }
  const lv = Math.round(level);
  val.textContent = lv + '%'; val.classList.remove('unavail');
  if (fill) fill.style.height = lv + '%';
  sl.setAttribute('aria-valuenow', String(lv));
  paintSliderColours(sl);
  if (sliderSel === '#volSlider') lastLevel.vol = lv; else lastLevel.bri = lv;
}
function wireSlider(sliderSel, valSel, action, key) {
  const sl = $(sliderSel), val = $(valSel);
  const bar = () => sl.querySelector('.vbar');
  const showLive = (v) => {
    val.textContent = v + '%'; val.classList.remove('unavail');
    const f = sl.querySelector('.vbar > i'); if (f) f.style.height = v + '%';
    sl.setAttribute('aria-valuenow', String(v));
    paintSliderColours(sl);
  };
  const levelFromEvent = (e) => {
    const r = bar().getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (r.bottom - e.clientY) / r.height)) * 100);
  };
  const commit = async (v) => {
    const r = await window.openisland.winControl(action, v).catch(() => ({ ok: false }));
    if (!r.ok) {
      // Item L: never surface the raw helper error — short friendly text.
      toast(key === 'vol' ? "Couldn't change volume right now" : "Couldn't change brightness right now");
      const last = lastLevel[key];
      if (last != null) showLive(last); else refreshControls();
    } else { lastLevel[key] = v; }
  };
  let dragging = false;
  sl.addEventListener('pointerdown', (e) => { dragging = true; sl.setPointerCapture(e.pointerId); showLive(levelFromEvent(e)); });
  sl.addEventListener('pointermove', (e) => { if (dragging) showLive(levelFromEvent(e)); });
  sl.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; commit(levelFromEvent(e)); });
  sl.addEventListener('keydown', (e) => {
    const cur = +(sl.getAttribute('aria-valuenow') || 0);
    let v = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = Math.min(100, cur + 5);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = Math.max(0, cur - 5);
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = 100;
    if (v != null) { e.preventDefault(); showLive(v); commit(v); }
  });
}
wireSlider('#volSlider', '#volVal', 'volume-set', 'vol');
wireSlider('#briSlider', '#briVal', 'brightness-set', 'bri');
function setTile(tileSel, stateSel, ok, on, onWord, offWord, fallbackWord) {
  const st = $(stateSel);
  // v1.0.0: a failed getter shows a word state, never "Unavailable" — the
  // fallback word (default: the off word) is the safe state for that tile.
  if (!ok) { st.textContent = fallbackWord || offWord; st.classList.remove('unavail'); $(tileSel).classList.remove('on'); return; }
  st.textContent = on ? onWord : offWord; st.classList.remove('unavail');
  $(tileSel).classList.toggle('on', !!on);
}
async function refreshControls() {
  const v = await window.openisland.winControl('volume-get').catch(() => null);
  setSlider('#volSlider', '#volVal', v && v.level);
  const b = await window.openisland.winControl('brightness-get').catch(() => null);
  setSlider('#briSlider', '#briVal', b && b.level);
  const wifi = await window.openisland.winControl('wifi-get').catch(() => null);
  setTile('#wifiTile', '#wifiState', wifi && wifi.ok, wifi && wifi.on, 'On', 'Off');
  const nl = await window.openisland.winControl('nightlight-get').catch(() => null);
  setTile('#nlTile', '#nlState', nl && nl.ok, nl && nl.on, 'On', 'Off');
  const focus = await window.openisland.winControl('focus-get').catch(() => null);
  setTile('#focusTile', '#focusState', focus && focus.ok, focus && focus.on, 'On', 'Off');
  const pm = await window.openisland.winControl('power-mode-get').catch(() => null);
  $$('[data-powermode]').forEach(x => x.classList.toggle('active', !!(pm && pm.ok && pm.mode === x.dataset.powermode)));
  const mic = await window.openisland.micState().catch(() => null);
  setTile('#micTile', '#micState', !!mic, mic && !mic.muted, 'On', 'Muted', 'On');
  setTile('#muteTile', '#muteState', !!mic, mic && mic.muted, 'Muted', 'Sound on');
  $('#spkState').textContent = 'Speakers'; // no output-device getter; the default device
  $('#spkState').classList.remove('unavail');
  requestIslandResize();
}
// v5.0.0 (item C): tile click feedback — while a toggle runs (PowerShell
// takes 2–4 s) the tile dims and shows "…" immediately, and further clicks
// are ignored, so a click never looks dead. On failure the tile keeps its
// previous state and the friendly toast stays; a tile whose programmatic
// toggle cannot work on this machine opens the matching Windows Settings
// page instead of being a dead button (Night Light, Focus).
const busyTiles = new Set();
async function runTile(tileSel, stateSel, fn) {
  if (busyTiles.has(tileSel)) return;
  busyTiles.add(tileSel);
  const tile = $(tileSel), st = $(stateSel);
  const prevText = st.textContent;
  tile.classList.add('busy');
  st.textContent = '…'; st.classList.remove('unavail');
  try { await fn(); }
  finally {
    busyTiles.delete(tileSel);
    tile.classList.remove('busy');
    // A success path refreshes the state via refreshControls(); if the
    // state word is still "…" the tile was never redrawn — restore the
    // previous word so the tile keeps its old state on failure.
    if (st.textContent === '…') st.textContent = prevText;
  }
}
// v1.0.0 (item B): a tile either works or honestly opens Windows Settings
// — never a dead button. Wi-Fi's WinRT SetStateAsync is access-denied from
// an unelevated desktop app and its netsh fallback needs admin, so on this
// machine the toggle cannot work and the tile opens the Wi-Fi settings
// page instead.
$('#wifiTile').addEventListener('click', () => runTile('#wifiTile', '#wifiState', async () => {
  const on = !$('#wifiTile').classList.contains('on');
  const r = await window.openisland.winControl('wifi-toggle', on);
  if (r.ok) await refreshControls();
  else { await window.openisland.openSettingsUri('ms-settings:network-wifi'); toast('Wi-Fi settings opened — toggle it there'); }
}));
$('#nlTile').addEventListener('click', () => runTile('#nlTile', '#nlState', async () => {
  const on = !$('#nlTile').classList.contains('on');
  const r = await window.openisland.winControl('nightlight-toggle', on);
  if (r.ok) await refreshControls();
  else { // the toggle cannot work on this machine — open Windows Night Light settings instead of a dead button
    await window.openisland.openSettingsUri('ms-settings:nightlight');
    toast('Night Light settings opened — toggle it there');
  }
}));
$('#focusTile').addEventListener('click', () => runTile('#focusTile', '#focusState', async () => {
  const on = !$('#focusTile').classList.contains('on');
  const r = await window.openisland.winControl('focus-toggle', on);
  if (r.ok) await refreshControls();
  else { // no reliable programmatic toggle on this machine — open Windows notification settings instead
    await window.openisland.openSettingsUri('ms-settings:quiethours');
    toast('Focus settings opened — change it there');
  }
}));
// v5.0.0 (item C): tile click feedback — while a toggle runs (PowerShell
// takes 2–4 s) the tile dims and shows "…" immediately, and further clicks
// are ignored, so a click never looks dead. On failure the tile keeps its
// previous state and the friendly toast stays; a tile whose programmatic
// toggle cannot work on this machine opens the matching Windows Settings
// page instead of being a dead button (Night Light, Focus).
$('#muteTile').addEventListener('click', () => runTile('#muteTile', '#muteState', async () => {
  const r = await window.openisland.toggleMicMute();
  if (r.ok) await refreshControls();
  else { await window.openisland.openSettingsUri('ms-settings:sound'); toast('Sound settings opened — mute the mic there'); }
}));
$('#micTile').addEventListener('click', () => switchTab('calls'));
$('#spkTile').addEventListener('click', () => window.openisland.openSettingsUri('ms-settings:sound'));
$$('[data-powermode]').forEach(b => b.addEventListener('click', async () => {
  const r = await window.openisland.winControl('power-mode-set', b.dataset.powermode);
  if (r.ok) { $$('[data-powermode]').forEach(x => x.classList.toggle('active', x === b)); toast('Power mode: ' + b.dataset.powermode); }
  else toast("Couldn't change power mode right now");
}));
// Favourite apps (6 slots, Settings → Keys; click to launch) — v1.0.0:
// they live in the ••• overflow menu now, not the Controls panel.
function renderFavourites() {
  const favs = S?.favourites || [];
  const box = $('#ovFavs');
  if (!box) return;
  const items = favs.map((f, i) => f && f.path
    ? `<button data-i="${i}" title="${f.name} — ${f.hotkey || 'no hotkey'}">${icon('zap')} ${f.name}</button>`
    : '').join('');
  box.innerHTML = items || `<button id="ovFavsSetup">${icon('gear')} Favourite apps…</button>`;
  $$('#ovFavs button[data-i]').forEach(b => b.addEventListener('click', async () => {
    $('#overflowMenu').classList.remove('open');
    const r = await window.openisland.launchFavourite(+b.dataset.i);
    if (!r.ok) toast('Could not launch that app');
  }));
  const setup = $('#ovFavsSetup');
  if (setup) setup.addEventListener('click', () => window.openisland.openSettings('keys'));
  requestIslandResize();
}
// Tools (v1.0.0): screenshot / region snip / screen recording live in the
// ••• overflow menu now. Recording state is a toast, not a panel line.
$('#ovShot').addEventListener('click', async () => {
  $('#overflowMenu').classList.remove('open');
  const r = await window.openisland.screenshot();
  toast(r.ok ? 'Screenshot saved — ' + r.file.split(/[\\/]/).pop() : 'Screenshot failed');
});
$('#ovSnip').addEventListener('click', () => { $('#overflowMenu').classList.remove('open'); window.openisland.snipStart(); });
let recorder = null, recChunks = [];
$('#ovRec').addEventListener('click', async () => {
  $('#overflowMenu').classList.remove('open');
  if (recorder) {
    recorder.stop();
    toast('Saving recording…');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' } }, audio: false });
    recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    recChunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recChunks, { type: 'video/webm' });
      const buf = await blob.arrayBuffer();
      const r = await window.openisland.recordingSave(buf);
      toast(r.ok ? 'Recording saved: ' + r.file.split(/[\\/]/).pop() : 'Recording save failed');
      recorder = null;
    };
    recorder.start();
    toast('Recording… tap Record screen again to stop');
  } catch (e) { toast('Recording unavailable'); }
});
refreshControls();

// --- clipboard ---
async function refreshClip() { renderClip(await window.openisland.clipboardList()); }
function renderClip(list) {
  $('#clipList').innerHTML = (list || []).map(it => `<div class="clipitem"><span class="txt" title="${it.text.replace(/"/g, '&quot;')}">${it.pinned ? icon('pin') + ' ' : ''}${it.kind === 'link' ? icon('external') + ' ' : ''}${it.text}</span><button class="btn" data-pin="${it.id}">${it.pinned ? 'Unpin' : 'Pin'}</button><button class="btn" data-copy="${it.id}">Copy</button><button class="btn" data-delclip="${it.id}">${icon('x')}</button></div>`).join('') || '<div class="muted small">Nothing copied yet.</div>';
  $$('[data-copy]').forEach(b => b.addEventListener('click', async () => { const it = (await window.openisland.clipboardList()).find(x => x.id === +b.dataset.copy); if (it) { await window.openisland.clipboardCopy(it.text); toast('Copied'); } }));
  $$('[data-delclip]').forEach(b => b.addEventListener('click', async () => renderClip(await window.openisland.clipboardDelete(+b.dataset.delclip))));
  $$('[data-pin]').forEach(b => b.addEventListener('click', async () => renderClip(await window.openisland.clipboardPin(+b.dataset.pin))));
  requestIslandResize();
}
$('#clipClear').addEventListener('click', async () => renderClip(await window.openisland.clipboardClear()));

// --- files ---
async function refreshShelf() { renderShelf(await window.openisland.shelfList()); }
function renderShelf(list) {
  $('#shelfList').innerHTML = (list || []).map(f => `<div class="shelfitem"><span class="txt">${icon('file-text')} ${f.name} <span class="muted small">(${(f.size / 1024).toFixed(0)} KB${f.from === 'phone' ? ' · from phone' : ''})</span></span><button class="btn" data-drag="${f.name}">Drag out</button><button class="btn" data-open="${f.path}">Open</button><button class="btn" data-rm="${f.name}">${icon('x')}</button></div>`).join('') || '<div class="muted small">Shelf is empty — drop files above.</div>';
  $$('[data-drag]').forEach(b => b.addEventListener('click', () => window.openisland.shelfDragOut(b.dataset.drag)));
  $$('[data-open]').forEach(b => b.addEventListener('click', () => window.openisland.winControl('open-path', b.dataset.open)));
  $$('[data-rm]').forEach(b => b.addEventListener('click', async () => renderShelf(await window.openisland.shelfRemove(b.dataset.rm))));
  requestIslandResize();
}
const dz = $('#dropzone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', async (e) => { e.preventDefault(); dz.classList.remove('over');
  const files = [...e.dataTransfer.files].map(f => ({ name: f.name, path: window.openisland.getPathForFile(f), size: f.size }));
  renderShelf(await window.openisland.shelfAdd(files)); toast(files.length + ' file(s) added to shelf');
});
$('#shareQrBtn').addEventListener('click', async () => { const r = await window.openisland.shelfShareQr(); $('#qrBox').style.display = 'block'; $('#qrImg').src = r.qr; $('#qrUrl').textContent = r.url; $('#shareUrl').textContent = r.url; });

// --- reminders ---
async function refreshReminders() { renderReminders(await window.openisland.remindersList()); }
function renderReminders(list) {
  $('#remList').innerHTML = (list || []).map(r => `<div class="clipitem"><span class="txt">${icon('clock')} ${r.text} <span class="muted small">— in ${Math.max(0, Math.round((r.at - Date.now()) / 1000))}s</span></span><button class="btn" data-done="${r.id}">Done</button></div>`).join('') || '<div class="muted small">No reminders.</div>';
  $$('[data-done]').forEach(b => b.addEventListener('click', async () => renderReminders(await window.openisland.reminderDone(+b.dataset.done))));
  requestIslandResize();
}
$('#remAdd').addEventListener('click', async () => { const t = $('#remText').value.trim(); if (!t) return; renderReminders(await window.openisland.reminderAdd({ text: t, seconds: Math.max(5, +$('#remSecs').value || 60) })); $('#remText').value = ''; toast('Reminder set'); });

// --- calls ---
async function refreshMic() { const m = await window.openisland.micState(); $('#micSw').classList.toggle('on', m.muted); $('#micStateText').textContent = m.muted ? 'Muted' : 'Live'; $('#micHint').textContent = m.inUse ? 'An app is using the mic right now — call timer is on the island.' : $('#micHint').textContent; }
$('#micSw').addEventListener('click', async () => { const r = await window.openisland.toggleMicMute(); if (!r.ok) toast("Couldn't mute the mic right now"); else refreshMic(); });
let camStream = null;
$('#camPreviewBtn').addEventListener('click', async () => {
  try { camStream = await navigator.mediaDevices.getUserMedia({ video: true }); const v = $('#camVideo'); v.srcObject = camStream; v.style.display = 'block'; }
  catch (e) { toast('Camera unavailable'); }
});
function stopCamera() { if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; } const v = $('#camVideo'); if (v) { v.srcObject = null; v.style.display = 'none'; } }
$('#camStopBtn').addEventListener('click', stopCamera);

// --- gaming / deck / stream ---
$('#gameMode').addEventListener('change', async (e) => { S.gaming.mode = e.target.value; await window.openisland.saveSettings({ gaming: { mode: S.gaming.mode } }); toast('Game strip: ' + S.gaming.mode); });
// BUG 3 (v2.0.0): the system strip on/off toggle, in the Gaming tab itself.
$('#stripSw').addEventListener('click', async (e) => { const on = !e.currentTarget.classList.contains('on'); S.gaming.showStrip = on; await window.openisland.saveSettings({ gaming: { showStrip: on } }); e.currentTarget.classList.toggle('on', on); toast(on ? 'System strip on' : 'System strip off'); });
$('#stripPos').addEventListener('change', async (e) => { S.gaming.stripPosition = e.target.value; await window.openisland.saveSettings({ gaming: { stripPosition: S.gaming.stripPosition } }); });
$('#slimStripSw').addEventListener('click', async (e) => { const on = !e.currentTarget.classList.contains('on'); S.gaming.slimStripMaximized = on; await window.openisland.saveSettings({ gaming: { slimStripMaximized: on } }); e.currentTarget.classList.toggle('on', on); toast(on ? 'Slim strip under maximized windows on' : 'Slim strip under maximized windows off'); });
// Real FPS consent (v2.0.0): one-time Allow/Deny; "—" until allowed + a game presents.
$('#fpsAllow').addEventListener('click', async () => { await window.openisland.fpsConsent('allowed'); S.gaming.fpsConsent = 'allowed'; syncGamingControls(); toast('FPS measurement on'); });
$('#fpsDeny').addEventListener('click', async () => { await window.openisland.fpsConsent('denied'); S.gaming.fpsConsent = 'denied'; syncGamingControls(); toast('FPS stays off — the strip shows —'); });
$('#deckSw').addEventListener('click', async (e) => { const on = !e.currentTarget.classList.contains('on'); S.deck.enabled = on; await window.openisland.saveSettings({ deck: { enabled: on } }); e.currentTarget.classList.toggle('on', on); toast(on ? 'PC Deck on — scan the QR to connect a phone.' : 'PC Deck off.'); });
$('#deckQrBtn').addEventListener('click', async () => { const r = await window.openisland.deckQr(); $('#deckQrBox').style.display = 'block'; $('#deckQrImg').src = r.qr; $('#deckQrUrl').textContent = r.url; });
$('#streamSw').addEventListener('click', async (e) => { const on = !e.currentTarget.classList.contains('on'); S.streaming.enabled = on; await window.openisland.saveSettings({ streaming: { enabled: on } }); e.currentTarget.classList.toggle('on', on); renderObs(null); });
$('#twitchOpen').addEventListener('click', () => { const ch = $('#twitchCh').value.trim(); if (ch) window.open('https://www.twitch.tv/popout/' + encodeURIComponent(ch) + '/chat?popout=', '_blank'); });
$('#ytOpen').addEventListener('click', () => { const u = $('#ytUrl').value.trim(); if (u) window.open(u, '_blank'); });
// OBS pill (v2.0.0): REC/LIVE with elapsed time + scene; honest "not connected".
let obsState = null, obsTick = null;
function renderObs(st) {
  if (st) obsState = st;
  const box = $('#obsBox');
  if (!obsState) { box.textContent = 'Checking OBS…'; return; }
  if (!obsState.connected) {
    box.innerHTML = `<span class="muted">Not connected — ${obsState.error || 'enable OBS in Settings → Streaming and start OBS Studio with its WebSocket server on.'}</span>`;
    $('#obsRecBtn').innerHTML = icon('record') + ' Start recording'; $('#obsStreamBtn').innerHTML = icon('radio') + ' Start stream';
    return;
  }
  const rec = obsState.recording ? `<span class="recdot"></span>REC ${fmt((obsState.recordMs || 0) / 1000)}` : '<span class="recdot off"></span>Not recording';
  const live = obsState.streaming ? ' <span class="recdot"></span>LIVE' : '';
  box.innerHTML = `<b>${rec}${live}</b> <span class="muted">Scene: ${obsState.scene || '—'}</span>`;
  $('#obsRecBtn').innerHTML = icon('record') + (obsState.recording ? ' Stop recording' : ' Start recording');
  $('#obsStreamBtn').innerHTML = icon('radio') + (obsState.streaming ? ' Stop stream' : ' Start stream');
  if (obsState.recording && !obsTick) {
    obsTick = setInterval(() => { if (obsState) { obsState.recordMs = (obsState.recordMs || 0) + 1000; renderObs(); } }, 1000);
  } else if (!obsState.recording && obsTick) { clearInterval(obsTick); obsTick = null; }
}
$('#obsRecBtn').addEventListener('click', async () => { const r = await window.openisland.obsRecordToggle(); if (!r.ok) toast('OBS unavailable right now'); else renderObs(await window.openisland.obsStatus()); });
$('#obsStreamBtn').addEventListener('click', async () => { const r = await window.openisland.obsStreamToggle(); if (!r.ok) toast('OBS unavailable right now'); else renderObs(await window.openisland.obsStatus()); });
$('#obsRetryBtn').addEventListener('click', async () => { renderObs(await window.openisland.obsConnect()); });
function renderRenderWatch(r) {
  const box = $('#renderBox');
  if (!r || !r.latest) { box.textContent = 'Set a render folder in Settings → Streaming. The pill then shows export size / speed / time and tells you when it is done.'; return; }
  box.innerHTML = `${icon('file-text')} ${r.latest.name} — ${(r.latest.size / 1048576).toFixed(1)} MB · ${r.latest.done ? '<b>Done</b>' : 'still writing…'}`;
}
// --- web drawer (pinned sites open in the default browser) ---
function renderWeb() {
  const list = S?.webDrawer || [];
  $('#webList').innerHTML = list.map((w, i) => `<div class="clipitem"><span class="txt">${icon('globe')} ${w.name} <span class="muted small">${w.url}</span></span><button class="btn" data-webopen="${i}">Open</button><button class="btn" data-webdel="${i}">${icon('x')}</button></div>`).join('') || '<div class="muted small">No pinned sites yet — add one above.</div>';
  $$('[data-webopen]').forEach(b => b.addEventListener('click', () => window.openisland.webOpen(list[+b.dataset.webopen].url)));
  $$('[data-webdel]').forEach(b => b.addEventListener('click', async () => {
    S.webDrawer.splice(+b.dataset.webdel, 1);
    await window.openisland.saveSettings({ webDrawer: S.webDrawer });
    renderWeb();
  }));
  requestIslandResize();
}
$('#webAdd').addEventListener('click', async () => {
  const name = $('#webName').value.trim(), url = $('#webUrl').value.trim();
  if (!name || !url) { toast('Give the site a name and a URL.'); return; }
  S.webDrawer = S.webDrawer || [];
  S.webDrawer.push({ name, url: url.startsWith('http') ? url : 'https://' + url });
  await window.openisland.saveSettings({ webDrawer: S.webDrawer });
  $('#webName').value = ''; $('#webUrl').value = '';
  renderWeb();
});
// --- notifications (Windows toasts + the app's own list) ---
async function renderNotifications() {
  const r = await window.openisland.notificationsList();
  const win = r.windows || {};
  $('#notifWinState').textContent = win.ok
    ? (win.items.length ? `${win.items.length} Windows notification(s) on this PC.` : 'No Windows notifications right now.')
    : `Windows notifications: ${win.error || 'unavailable'} — the app's own notifications are listed below.`;
  $('#notifWinList').innerHTML = (win.items || []).map(n => `<div class="clipitem"><span class="txt">${n.title || '(no title)'} <span class="muted small">${n.body || ''}</span></span></div>`).join('');
  $('#notifAppList').innerHTML = (r.app || []).map(n => `<div class="clipitem"><span class="txt">${n.text} <span class="muted small">${new Date(n.at).toLocaleTimeString()}</span></span></div>`).join('') || '<div class="muted small">No app notifications yet.</div>';
  requestIslandResize();
}
$('#notifReqBtn').addEventListener('click', async () => {
  const r = await window.openisland.notificationsRequest();
  toast(r.ok ? 'Windows notification access: ' + (r.access || 'granted') : "Couldn't check notification access right now");
  renderNotifications();
});

init();
