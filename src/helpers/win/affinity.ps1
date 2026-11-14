# SetWindowDisplayAffinity: keep the Glass island out of screenshots/recordings.
# Usage: affinity.ps1 <hwnd> <exclude|include>
#   exclude: WDA_EXCLUDEFROMCAPTURE (0x11) - the window is invisible to
#            screen-capture APIs (DXGI duplication, BitBlt, OBS display
#            capture). Glass surfaces read the screen behind the island,
#            so Windows keeps them out of every capture while this is set.
#   include: WDA_NONE (0) - normal, the window shows in captures.
# Applied to the island (and strip/dock) while a Glass surface is active;
# removed when OBS is recording/streaming so the island shows in the video.
param([long]$Hwnd, [string]$Mode = 'exclude')
try {
  $src = @'
using System;
using System.Runtime.InteropServices;
public static class AF {
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr h, uint a);
}
'@
  Add-Type -TypeDefinition $src -ErrorAction Stop | Out-Null
  $aff = if ($Mode -eq 'exclude') { [uint]0x11 } else { [uint]0 }
  $ok = [AF]::SetWindowDisplayAffinity([IntPtr]::new($Hwnd), $aff)
  '{"ok":' + $(if ($ok) { 'true' } else { 'false' }) + '}'
} catch { '{"ok":false,"error":"affinity failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
