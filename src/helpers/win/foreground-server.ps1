# Persistent foreground helper process (v1.0.2) - ONE long-lived
# powershell.exe serves every foreground check over stdin/stdout, instead
# of spawning a fresh powershell.exe per poll.
# Why: the per-poll spawn cost 2.1 s on PJ's machine (fresh powershell.exe
# + .NET assembly load) while the v1.0.1 poll capped each helper at 2 s -
# so the reading was killed before it arrived, no confirmed reading ever
# landed, and fail-closed hid the island every ~10 s (the open/close cycle
# in PJ's video). The same stale readings also showed the island over
# Chrome when a late "openisland" reading arrived while Chrome was in
# front. A persistent process answers in ~100-300 ms: the assemblies load
# once at startup and each request is just the UIA query.
# Protocol: the caller writes one line to stdin ("main" or "lite"); this
# process writes EXACTLY ONE JSON line to stdout per request, then waits
# for the next line. When stdin closes (caller died) the loop ends and
# the process exits on its own - no orphan powershell.exe.
# The check logic is the same as foreground.ps1 / foreground-lite.ps1
# (UI Automation, no C# compile, same JSON shape), refactored into
# functions that RETURN the JSON string instead of printing it + exit.
# $procId, not $pid: $pid is PowerShell's READ-ONLY automatic variable
# (case-insensitive) - assigning to it crashes every invocation.
# ASCII only, like every helper (a non-ASCII byte once broke gpu.ps1).
try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop | Out-Null
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop | Out-Null
} catch {
  [Console]::WriteLine('{"error":"foreground server failed to load UI Automation: ' + ($_.Exception.Message -replace '"', "'") + '"}')
  exit 1
}

# UIA rect coordinates are doubles and can be non-finite (Rect.Empty is
# +/-Infinity for desktop/root elements) or far outside Int32 range. A
# bare [int] cast throws "Value was either too large or too small for an
# Int32" on those (v1.0.2 log openisland-5.log: both foreground checks
# died on the desktop with exactly that error, twice fail-closing the
# island). The only [int] conversions in the foreground path are these
# rect casts, and both functions fail identically at desktop-foreground
# times. Convert safely: non-finite -> 0, else clamp to a sane screen
# range and round to a 64-bit value (JSON numbers carry it fine).
function Convert-RectCoord([double]$v) {
  if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { return [long]0 }
  $c = [math]::Max(-2000000000.0, [math]::Min(2000000000.0, $v))
  return [long][math]::Round($c)
}

function Get-ForegroundMain {
  try {
    $el = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $el) { return '{"hwnd":0,"title":"","class":"","process":"","isFullscreen":false,"isMaximized":false,"rect":null}' }
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
    $json = [pscustomobject]@{
      hwnd = [int64]$hwnd; title = [string]$title; class = [string]$cls; process = $proc
      isFullscreen = $isFullscreen; isMaximized = $isMaximized
      rect = [pscustomobject]@{ left = (Convert-RectCoord $r.Left); top = (Convert-RectCoord $r.Top); right = (Convert-RectCoord ($r.Left + $r.Width)); bottom = (Convert-RectCoord ($r.Top + $r.Height)) }
    } | ConvertTo-Json -Compress -Depth 3
    return $json
  } catch { return '{"error":"foreground check failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
}

function Get-ForegroundLite {
  try {
    $el = [System.Windows.Automation.AutomationElement]::FocusedElement
    # Nothing has focus: desktop-like, not a failure (see foreground-lite.ps1).
    if ($null -eq $el) { return '{"noFocus":true,"via":"uia"}' }
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
    $json = [pscustomobject]@{
      hwnd = [int64]$hwnd; title = [string]$title; class = [string]$cls; process = $proc
      isFullscreen = $isFullscreen; isMaximized = $isMaximized; via = 'uia'
      rect = [pscustomobject]@{ left = (Convert-RectCoord $r.Left); top = (Convert-RectCoord $r.Top); right = (Convert-RectCoord ($r.Left + $r.Width)); bottom = (Convert-RectCoord ($r.Top + $r.Height)) }
    } | ConvertTo-Json -Compress -Depth 3
    return $json
  } catch { return '{"error":"foreground-lite check failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
}

# Line protocol: exactly one JSON line out per line in, so the caller can
# never desync. An unknown or empty line still gets an error line back.
while ($true) {
  $line = [Console]::ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  try {
    if ($line -eq 'main') { $out = Get-ForegroundMain }
    elseif ($line -eq 'lite') { $out = Get-ForegroundLite }
    else { $out = '{"error":"unknown foreground command"}' }
  } catch { $out = '{"error":"foreground server failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
  [Console]::WriteLine($out)
}
