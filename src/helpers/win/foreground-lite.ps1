# Lightweight foreground check (v1.0.0 item C) - the fallback when
# foreground.ps1 persistently fails. It uses UI Automation
# (UIAutomationClient, a framework assembly load) instead of Add-Type C#
# compilation, so it works on machines where the compiled helper cannot run
# at all. v1.0.1: $pid is PowerShell's read-only automatic variable
# (case-insensitive) - the old `$pid = $target.Current.ProcessId` crashed
# every invocation; the process id now lives in $procId. Returns the SAME
# JSON shape as foreground.ps1, plus "via":"uia".
#   {"noFocus":true} means no element has focus right now - nothing is
#   focused, which on a real machine means the desktop/shell is in front
#   (a real app in front almost always owns the focus). The caller treats
#   it as a desktop-like signal, NOT a failure.
# On any failure it prints {"error": "<real message>"} - never a generic
# string, so openisland.log can actually diagnose it.
# v1.0.3: UIA rect coordinates are doubles and can be non-finite
# (Rect.Empty is +/-Infinity for desktop/root elements) or far outside
# Int32 range - a bare [int] cast throws "Value was either too large or
# too small for an Int32" (v1.0.2 log: both checks died on the desktop
# with exactly that error). Convert-RectCoord clamps safely to a 64-bit
# value instead (non-finite -> 0).
function Convert-RectCoord([double]$v) {
  if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { return [long]0 }
  $c = [math]::Max(-2000000000.0, [math]::Min(2000000000.0, $v))
  return [long][math]::Round($c)
}
try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $el) { '{"noFocus":true,"via":"uia"}'; exit 0 }
  # Walk up to the containing window (the element that supports WindowPattern).
  $w = $el
  $winPat = $null
  while ($null -ne $w) {
    try { $winPat = $w.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern); break }
    catch { $w = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($w) }
  }
  $target = if ($null -ne $winPat) { $w } else { $el }
  $title = $target.Current.Name
  if ($null -eq $title) { $title = '' }
  $cls = $target.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ClassNameProperty)
  if ($null -eq $cls) { $cls = '' }
  $procId = $target.Current.ProcessId
  $proc = ''
  try { $proc = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $proc = '' }
  $hwnd = $target.Current.NativeWindowHandle
  if ($null -eq $hwnd) { $hwnd = 0 }
  $isMaximized = $false
  if ($null -ne $winPat) { $isMaximized = ($winPat.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Maximized) }
  $r = $target.Current.BoundingRectangle
  $sw = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
  $sh = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height
  $isFullscreen = ($r.Left -le 0 -and $r.Top -le 0 -and $r.Width -ge $sw -and $r.Height -ge $sh)
  [pscustomobject]@{
    hwnd = [int64]$hwnd; title = [string]$title; class = [string]$cls; process = $proc
    isFullscreen = $isFullscreen; isMaximized = $isMaximized; via = 'uia'
    rect = [pscustomobject]@{ left = (Convert-RectCoord $r.Left); top = (Convert-RectCoord $r.Top); right = (Convert-RectCoord ($r.Left + $r.Width)); bottom = (Convert-RectCoord ($r.Top + $r.Height)) }
  } | ConvertTo-Json -Compress -Depth 3
} catch { '{"error":"foreground-lite check failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
