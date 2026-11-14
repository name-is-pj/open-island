# Reserve / restore the screen work area (so maximised windows stop above our dock).
# Usage: workarea.ps1 <get|set|restore> [bottomReservePx]
#   get:     {"ok":true,"rect":{left,top,right,bottom}}
#   set N:   reserves N px at the bottom of the primary monitor's work area
#   restore: restores the full-screen work area
# Uses SystemParametersInfo SPI_GETWORKAREA / SPI_SETWORKAREA (the same
# mechanism the Windows taskbar uses). The original rect is returned by get
# so the caller can restore it exactly.
param([string]$Cmd = 'get', [int]$Reserve = 0)
try {
  $src = @'
using System;
using System.Runtime.InteropServices;
public static class WA2 {
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, ref RECT r, uint f);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public const uint SPI_GETWORKAREA = 0x0030;
  public const uint SPI_SETWORKAREA = 0x002F;
  public const uint SPIF_UPDATEINIFILE = 0x01;
  public const uint SPIF_SENDCHANGE = 0x02;
}
'@
  Add-Type -TypeDefinition $src -ErrorAction Stop | Out-Null
  $r = New-Object WA2+RECT
  if ($Cmd -eq 'get') {
    [void][WA2]::SystemParametersInfo([WA2]::SPI_GETWORKAREA, 0, [ref]$r, 0)
    '{"ok":true,"rect":{"left":' + $r.Left + ',"top":' + $r.Top + ',"right":' + $r.Right + ',"bottom":' + $r.Bottom + '}}'
    exit 0
  }
  if ($Cmd -eq 'set') {
    [void][WA2]::SystemParametersInfo([WA2]::SPI_GETWORKAREA, 0, [ref]$r, 0)
    $r.Bottom = $r.Bottom - $Reserve
    [void][WA2]::SystemParametersInfo([WA2]::SPI_SETWORKAREA, 0, [ref]$r, [WA2]::SPIF_UPDATEINIFILE -bor [WA2]::SPIF_SENDCHANGE)
    '{"ok":true,"bottom":' + $r.Bottom + '}'
    exit 0
  }
  if ($Cmd -eq 'restore') {
    # Restore the work area Windows itself would use: full screen minus the
    # visible Windows taskbar (if it is currently shown). The old version
    # always restored to full height, which let maximised windows slide under
    # a visible taskbar after our dock was toggled off.
    $full = New-Object WA2+RECT
    $full.Left = 0; $full.Top = 0
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop | Out-Null
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $full.Right = $b.Width; $full.Bottom = $b.Height
    try {
      $traySrc = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TR {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder b, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static int VisibleTrayHeight() {
    int h = 0;
    EnumWindows((wnd, l) => {
      var sb = new StringBuilder(256);
      GetClassName(wnd, sb, sb.Capacity);
      if (sb.ToString() == "Shell_TrayWnd" && IsWindowVisible(wnd)) {
        RECT r; if (GetWindowRect(wnd, out r)) { h = r.Bottom - r.Top; }
      }
      return true;
    }, IntPtr.Zero);
    return h;
  }
}
'@
      Add-Type -TypeDefinition $traySrc -ErrorAction Stop | Out-Null
      $th = [TR]::VisibleTrayHeight()
      if ($th -gt 0) { $full.Bottom = $full.Bottom - $th }
    } catch { /* taskbar height unknown - full height is the safe fallback */ }
    [void][WA2]::SystemParametersInfo([WA2]::SPI_SETWORKAREA, 0, [ref]$full, [WA2]::SPIF_UPDATEINIFILE -bor [WA2]::SPIF_SENDCHANGE)
    '{"ok":true}'
    exit 0
  }
  '{"ok":false,"error":"unknown command"}'
} catch { '{"ok":false,"error":"workarea failed"}' }
