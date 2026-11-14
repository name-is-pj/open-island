# Report the current Windows foreground window (for desktop-only island scope,
# per-app rules, slim-strip-under-maximised and live-wallpaper pause).
# Returns JSON: { hwnd, title, class, process, isFullscreen, isMaximized,
# rect:{left,top,right,bottom} } - e.g. class Progman/WorkerW with process
# explorer means the desktop/shell is in front. isFullscreen = the window
# covers the whole screen; isMaximized = the window pattern says so.
# v1.0.1: NO Add-Type C# compile any more. The old version compiled C# on
# EVERY invocation (a fresh powershell.exe each time), which took ~15 s per
# reading while the poll runs every 500 ms - readings arrived 15 s stale,
# runPs's 15 s timeout killed the helper before it could answer, and the
# back-to-back compiles saturated the machine so badly that every OTHER
# helper started failing with "Command failed" too. This version uses UI
# Automation (UIAutomationClient, a framework assembly load, ~1 s) - the
# same technique as foreground-lite.ps1. Same JSON shape, so main.js is
# untouched for parsing.
# v1.0.1: $pid is PowerShell's READ-ONLY automatic variable (the current
# process ID - PowerShell variables are case-insensitive, so $pid and $PID
# are the same name). The old script assigned `$pid = 0` here, which crashed
# every invocation with "Cannot overwrite variable PID because it is
# read-only or constant" - BOTH foreground checks failed on every poll, no
# confirmed reading ever arrived, and fail-open kept the island visible over
# Chrome. The process id now lives in $procId. (The C# `out uint pid` in the
# old version was fine - C# is case-sensitive - but it is gone with the
# compile; grep case-insensitively for $pid from now on.)
# On failure the error payload carries the REAL exception message (the old
# generic "foreground check failed" hid the cause - a persistently failing
# helper left no diagnosable trace in openisland.log). The caller still
# treats an error payload as "no reading" (fail-open for a transient
# failure, fail-closed after 10 s with no confirmed reading from either
# check - see pollForeground in main.js).
try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $el) { '{"hwnd":0,"title":"","class":"","process":"","isFullscreen":false,"isMaximized":false,"rect":null}'; exit 0 }
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
    isFullscreen = $isFullscreen; isMaximized = $isMaximized
    rect = [pscustomobject]@{ left = [int]$r.Left; top = [int]$r.Top; right = [int]($r.Left + $r.Width); bottom = [int]($r.Top + $r.Height) }
  } | ConvertTo-Json -Compress -Depth 3
} catch { '{"error":"foreground check failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
