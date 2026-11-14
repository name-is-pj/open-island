# Usage: taskbar.ps1 <hide|show|status> - hides / shows the Windows taskbar,
# or reports its current visibility without changing anything.
# v3.0.0 rewrite (item 9): direct Win32 hide - FindWindow("Shell_TrayWnd")
# + FindWindow("Shell_SecondaryTrayWnd") (one per extra monitor) +
# ShowWindow(SW_HIDE / SW_SHOW). The v1/v2 version wrote the StuckRects3
# registry value (auto-hide, not a hide) and killed Explorer to apply it -
# both are DELETED here: no registry write of any kind, no Explorer kill.
# Also never touched: the Winlogon Shell key, the auto-hide registry value.
# Hiding alone does not reclaim the space - main.js also calls workarea.ps1
# (SPI_SETWORKAREA) to give maximised windows the full height, and restores
# the taskbar + work area on toggle-off, on quit, and via a 5s watchdog
# while the dock is enabled (Explorer restarts recreate it visible).
# v5.0.0 (item D1): the result is VERIFIED, not assumed - after a hide/show
# the script re-reads IsWindowVisible on the primary Shell_TrayWnd and
# returns the real state. A hide that did not stick is reported as such
# (hidden:false) instead of claiming success. 'status' returns the same
# visibility reading without changing anything (watchdog use).
# Returns {"ok":true,"hidden":true|false,"visible":true|false,"windows":N}.
# Never throws: errors are JSON too.
param([string]$Cmd)
try {
  $src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TB {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder b, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public const int SW_HIDE = 0;
  public const int SW_SHOW = 5;
  // Hide/show EVERY tray window: the primary Shell_TrayWnd plus one
  // Shell_SecondaryTrayWnd per extra monitor (FindWindow alone only finds
  // the first of a class, so enumerate instead).
  public static int SetAll(bool show) {
    int nCmd = show ? SW_SHOW : SW_HIDE;
    int count = 0;
    EnumWindows((h, l) => {
      var sb = new StringBuilder(256);
      GetClassName(h, sb, sb.Capacity);
      string c = sb.ToString();
      if (c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") { ShowWindow(h, nCmd); count++; }
      return true;
    }, IntPtr.Zero);
    return count;
  }
  public static int Count() {
    int count = 0;
    EnumWindows((h, l) => {
      var sb = new StringBuilder(256);
      GetClassName(h, sb, sb.Capacity);
      string c = sb.ToString();
      if (c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") count++;
      return true;
    }, IntPtr.Zero);
    return count;
  }
  // True when the primary taskbar window is actually visible right now.
  // Falls back to "any tray window visible" when FindWindow misses it
  // (a taskbar recreated by Explorer under a different handle, for example).
  public static bool IsVisible() {
    IntPtr tray = FindWindow("Shell_TrayWnd", null);
    if (tray != IntPtr.Zero) return IsWindowVisible(tray);
    bool any = false;
    EnumWindows((h, l) => {
      var sb = new StringBuilder(256);
      GetClassName(h, sb, sb.Capacity);
      string c = sb.ToString();
      if ((c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") && IsWindowVisible(h)) any = true;
      return true;
    }, IntPtr.Zero);
    return any;
  }
}
'@
  Add-Type -TypeDefinition $src -ErrorAction Stop | Out-Null
  if ($Cmd -eq 'status') {
    $vis = [TB]::IsVisible()
    $count = [TB]::Count()
    "{`"ok`":true,`"hidden`":$(if ($vis) { 'false' } else { 'true' }),`"visible`":$(if ($vis) { 'true' } else { 'false' }),`"windows`":$count}"
    exit 0
  }
  if ($Cmd -ne 'hide' -and $Cmd -ne 'show') { '{"ok":false,"error":"unknown command (use hide | show | status)"}'; exit 0 }
  $show = $Cmd -eq 'show'
  $count = [TB]::SetAll($show)
  # Verify: re-read the real visibility after the call - a ShowWindow that
  # Explorer immediately undoes (or a missing tray window) must not be
  # reported as a success.
  $vis = [TB]::IsVisible()
  $hidden = -not $vis
  "{`"ok`":true,`"hidden`":$(if ($hidden) { 'true' } else { 'false' }),`"visible`":$(if ($vis) { 'true' } else { 'false' }),`"windows`":$count}"
} catch {
  $msg = ($_.Exception.Message -replace '"', "'")
  "{`"ok`":false,`"error`":`"$msg`"}"
}
