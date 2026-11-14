# OpenIsland v1.0.0

A **free, original** Dynamic Island for Windows 10 (2004+) / 11 x64.
No account, no ads, no telemetry, no payment. Settings live in a local JSON file.

## What's in v1.0.0

Black + white + red theme (near-black cards, white active fills, red progress
wave), one shared card width, compact cards that fit their content, no banners
or instructions inside the island, and a bare icon strip with no bar behind it.

- **Hover switches panels.** Moving the pointer onto a panel icon opens that panel right away — no click needed.
- **Volume and Wi-Fi work.** Volume reads and sets the real system volume. Where Windows blocks a toggle from an unelevated app, the tile opens the matching Windows Settings page instead of a dead button — never a fake state.
- **The island only ever shows on the desktop.** A second lightweight foreground check backs up the main one, and if neither can tell what's in front, the island hides rather than sitting over your apps. The foreground check logs its real error, so a failing check can be diagnosed.
- **Taskbar rule.** The Windows taskbar hides only while the island's own taskbar is on — never on its own.
- **First-run tour is a separate dialog.** The welcome tour is its own window; the island itself carries no banner.
- **Settings → Appearance.** Named surface buttons (Glass selected, white-filled), live Resting/Open preview with the real island card. The window is ~780 px wide and Appearance fits without scrolling.
- **Desktop widgets sit in a fixed grid.** Day clock, weather and stats restore at the top-left without overlapping.
- **Taskbar pill.** Floating centred pill with the now-playing mini card (real album art), a chevron, tray icons, volume, clock with date, and bell — plus a small now-playing chip that floats above it briefly when the track changes.
- **Music, widgets and controls.** Music shows every app playing audio via Windows SMTC, one card per app with artwork, title/artist, play/pause, next/previous. Widgets hold the date with a mini week calendar, a focus timer, the weather, and CPU / GPU / RAM bars with network speed. Controls have two white sliders for brightness and volume, six tiles that always show a word for their state, and a Battery / Balanced / Performance switch.
- **Live-apply settings — no Save button.** Every setting applies the instant it changes (theme, accent colour, corner radius, shape, widths, open delay, every toggle and slider, per-app rules). Persistence is automatic on change. The Settings window itself re-themes live.
- **Clipboard history, file shelf, reminders, calls, game strip, notifications.** Clipboard history is encrypted for the Windows account; the file shelf drops files and sends them to your phone via QR; reminders pop up over fullscreen; calls have a mic-mute hotkey and call timer; the game strip shows real CPU / GPU / RAM / FPS; Windows notifications are mirrored in one on-PC list.

## Install & update — one file does both

Each release ships its full files on GitHub Releases — one release per version
(https://github.com/name-is-pj/open-island/releases), each carrying its full
installer + portable zip.

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

## Not in this version (deliberate)

- **21 languages** — this version is English only; strings are structured for i18n later.
- **Direct streaming logins** — login-and-play inside the island for Spotify / YouTube Music / Apple Music is a later version. Spotify needs the Web Playback SDK + Premium + a Spotify developer app the user creates; YouTube Music has no official playback API; Apple Music needs a paid Apple Developer MusicKit token. SMTC multi-session already covers "anything playing on the PC" with no login.
- **AI features** — the Settings sidebar has an AI-agents section that explains what such a section does (research only); no AI features are built.
- **Colour picker at the pointer** — Ctrl+Alt+C samples the screen centre; pointer-position sampling needs a native helper and is not in this version.

## Project layout

```
app/
  package.json            npm start / npm run build:win (electron-builder --win --dir, portable)
  cli.js                  localhost CLI: openisland notify "..."
  src/main.js             windows, tray, hotkeys, clipboard, media, servers
  src/preload.js          context-isolated bridge
  src/renderer/           index.html + app.js (island), settings.html, widget.html,
                          gamestrip.html, reminder.html, styles.css
  src/helpers/win/*.ps1   Windows-only PowerShell helpers (run only on Windows)
  assets/                 icon.png, icon.ico, tray.png — neon Open Island artwork
```

## Licence

MIT. Original code; no third-party app branding, assets or code.

Questions? Reach out to us at pjdevelopers9536@gmail.com.
