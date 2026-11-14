# Attach an Electron window behind the desktop icons as a live wallpaper.
# Progman/WorkerW reparenting, simplified:
#   1. FindWindow("Progman") -> SendMessageTimeout 0x052C (wParam 0xD, lParam 1
#      on Windows 11) makes Explorer spawn a WorkerW behind the icon layer.
#   2. Find the WorkerW that comes AFTER the one containing SHELLDLL_DefView.
#   3. SetParent(yourHwnd, that WorkerW) + SetWindowPos to cover its rect.
# Usage: wallpaper-attach.ps1 <hwnd>
# Returns {"ok":true} or {"ok":false,"error":...}. Undocumented shell
# behaviour - Explorer restarts destroy the WorkerW, so the app re-attaches
# on a watchdog (see main.js). Detach = just destroy the window.
param([long]$Hwnd)
try {
  $src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WA {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr c, string cl, string t);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
  Add-Type -TypeDefinition $src -ErrorAction Stop | Out-Null
  $progman = [WA]::FindWindow('Progman', 'Program Manager')
  if ($progman -eq [IntPtr]::Zero) { '{"ok":false,"error":"Progman not found"}'; exit 0 }
  $res = [IntPtr]::Zero
  [void][WA]::SendMessageTimeout($progman, 0x052C, [UIntPtr]::new(0xD), [IntPtr]::new(1), 0, 1000, [ref]$res)
  Start-Sleep -Milliseconds 300
  # Find the WorkerW containing SHELLDLL_DefView, then take the NEXT WorkerW.
  $shellView = [WA]::FindWindowEx([IntPtr]::Zero, [IntPtr]::Zero, 'SHELLDLL_DefView', $null)
  $host = [IntPtr]::Zero
  if ($shellView -ne [IntPtr]::Zero) {
    $parent = [IntPtr]::Zero
    # Walk up: SHELLDLL_DefView's parent is a WorkerW; find it via EnumWindows order.
    $found = $false
    $cb = {
      param($h, $l)
      $child = [WA]::FindWindowEx($h, [IntPtr]::Zero, 'SHELLDLL_DefView', $null)
      if ($child -ne [IntPtr]::Zero) { $script:foundParent = $h; $script:found = $true; return $false }
      return $true
    }
    $script:foundParent = [IntPtr]::Zero; $script:found = $false
    [void][WA]::EnumWindows($cb, [IntPtr]::Zero)
    if ($script:found) {
      # The wallpaper host is the next top-level WorkerW after that parent.
      $next = [WA]::FindWindowEx([IntPtr]::Zero, $script:foundParent, 'WorkerW', $null)
      if ($next -ne [IntPtr]::Zero) { $host = $next }
    }
  }
  if ($host -eq [IntPtr]::Zero) { '{"ok":false,"error":"wallpaper WorkerW not found"}'; exit 0 }
  $target = [IntPtr]::new($Hwnd)
  $old = [WA]::SetParent($target, $host)
  if ($old -eq [IntPtr]::Zero) { '{"ok":false,"error":"SetParent failed"}'; exit 0 }
  $rect = New-Object WA+RECT
  [void][WA]::GetWindowRect($host, [ref]$rect)
  $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
  [void][WA]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, $w, $h, 0x0040) # SWP_SHOWWINDOW
  '{"ok":true,"width":' + $w + ',"height":' + $h + '}'
} catch { '{"ok":false,"error":"' + ($_.Exception.Message -replace '"', "'") + '"}' }
