// Apply the neon Open Island icon to the Windows exe.
//
// Why this exists: electron-builder embeds the exe icon with rcedit, which
// needs Wine on Linux — and `npm run build:win` on Linux is run with
// `-c.win.signAndEditExecutable=false`, which skips exe editing entirely
// (so a Linux-built exe keeps Electron's default icon). This script does the
// same job in pure JS with `resedit` (no Wine): it replaces the exe's icon
// group with assets/icon.ico and leaves every other resource untouched
// (verified: non-icon resources byte-identical, PE still valid).
// On a Windows machine `npm run build:win` embeds the icon natively and this
// script is a harmless no-op check (it still verifies the icon is present).
//
// Usage: npm run icon:exe   (after `npm run build:win`)
const fs = require('fs');
const path = require('path');

const EXE = path.join(__dirname, '..', 'release', 'win-unpacked', 'OpenIsland.exe');
const ICO = path.join(__dirname, '..', 'assets', 'icon.ico');

function main() {
  const RE = require('resedit');
  if (!fs.existsSync(EXE)) {
    console.error('exe not found (run `npm run build:win` first):', EXE);
    process.exit(1);
  }
  const exe = RE.NtExecutable.from(fs.readFileSync(EXE));
  const res = RE.NtExecutableResource.from(exe);
  const groups = RE.Resource.IconGroupEntry.fromEntries(res.entries);
  const iconFile = RE.Data.IconFile.from(fs.readFileSync(ICO));
  const gid = groups.length ? groups[0].id : 101;
  const lang = groups.length ? groups[0].lang : 1033;
  RE.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, gid, lang, iconFile.icons.map((i) => i.data)
  );
  res.outputResource(exe);
  fs.writeFileSync(EXE, Buffer.from(exe.generate()));

  // verify: every icon size from the .ico must now be findable in the exe
  const ico = fs.readFileSync(ICO);
  const exeBytes = fs.readFileSync(EXE);
  const n = ico.readUInt16LE(4);
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const off = 6 + i * 16;
    const size = ico.readUInt32LE(off + 8);
    const dataOff = ico.readUInt32LE(off + 12);
    if (exeBytes.indexOf(ico.subarray(dataOff, dataOff + 64)) >= 0) hits++;
  }
  console.log(`exe icon: ${hits}/${n} sizes embedded in ${path.basename(EXE)}`);
  if (hits !== n) process.exit(1);
}

main();
