# Report the current Windows foreground window (for desktop-only island scope,
# per-app rules, slim-strip-under-maximised and live-wallpaper pause).
# Returns JSON: { hwnd, title, class, process, isFullscreen, isMaximized,
# rect:{left,top,right,bottom} } - e.g. class Progman/WorkerW with process
# explorer means the desktop/shell is in front. isFullscreen = the window
# covers the whole screen; isMaximized = GetWindowPlacement says so.
# v1.0.0 (item B/C): on failure the error payload carries the REAL exception
# message (the old generic "foreground check failed" hid the cause - a
# persistently failing helper left no diagnosable trace in openisland.log).
# The caller still treats an error payload as "no reading" (fail-open for a
# transient failure, fail-closed only after persistent failure of both this
# helper and the lightweight fallback - see pollForeground in main.js).
try {
  $src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder b, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder b, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT p);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT { public uint Length; public uint Flags; public uint ShowCmd; public POINT MinPosition; public POINT MaxPosition; public RECT NormalPosition; }
}
'@
  Add-Type -TypeDefinition $src -ErrorAction Stop | Out-Null
  $hwnd = [FG]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { '{"hwnd":0,"title":"","class":"","process":"","isFullscreen":false,"isMaximized":false,"rect":null}'; exit 0 }
  $cls = New-Object System.Text.StringBuilder(256)
  [void][FG]::GetClassName($hwnd, $cls, $cls.Capacity)
  $txt = New-Object System.Text.StringBuilder(512)
  [void][FG]::GetWindowText($hwnd, $txt, $txt.Capacity)
  $pid = 0
  [void][FG]::GetWindowThreadProcessId($hwnd, [ref]$pid)
  $proc = ''
  try { $proc = (Get-Process -Id $pid -ErrorAction Stop).ProcessName } catch { $proc = '' }
  $rect = New-Object FG+RECT
  $hasRect = [FG]::GetWindowRect($hwnd, [ref]$rect)
  $sw = [FG]::GetSystemMetrics(0); $sh = [FG]::GetSystemMetrics(1)
  $isFullscreen = $false
  if ($hasRect) { $isFullscreen = ($rect.Left -le 0 -and $rect.Top -le 0 -and ($rect.Right - $rect.Left) -ge $sw -and ($rect.Bottom - $rect.Top) -ge $sh) }
  $wp = New-Object FG+WINDOWPLACEMENT
  $wp.Length = [System.Runtime.InteropServices.Marshal]::SizeOf($wp)
  $isMaximized = $false
  if ([FG]::GetWindowPlacement($hwnd, [ref]$wp)) { $isMaximized = ($wp.ShowCmd -eq 3) } # SW_SHOWMAXIMIZED
  [pscustomobject]@{
    hwnd = $hwnd.ToInt64(); title = $txt.ToString(); class = $cls.ToString(); process = $proc
    isFullscreen = $isFullscreen; isMaximized = $isMaximized
    rect = if ($hasRect) { [pscustomobject]@{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom } } else { $null }
  } | ConvertTo-Json -Compress -Depth 3
} catch { '{"error":"foreground check failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
