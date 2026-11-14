# Usage: media-control.ps1 <toggle|next|previous|play|pause|seek> <sessionId> [seconds]
# v3.0.0: per-session control ONLY, by the session id (SourceAppUserModelId
# from media.ps1, or "title:<title>" for apps without one). There is NO
# GetCurrentSession() fallback any more: without a matching session it errors
# out instead of silently controlling the wrong app (the old fallback is how
# the dock toggle and the Deck endpoint could pause the wrong player).
#   seek <sessionId> <seconds> -> TryChangePlaybackPositionAsync (set position).
param([string]$Cmd, [string]$SessionId, [double]$Value = 0)
# v1.0.3: the WinRT SMTC type must actually RESOLVE before it is used -
# see media.ps1 for the full note. The old SilentlyContinue load hid the
# failure and the literal type reference then died with "Unable to find
# type" on every call, so play/pause/next/previous never ran at all.
$smTCType = $null
$winrtLoadError = ''
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop | Out-Null
  $smTCType = [Type]::GetType('Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime')
  if ($null -eq $smTCType) {
    $winmd = Join-Path $env:SystemRoot 'System32\WinMetadata\Windows.Media.Control.winmd'
    if (Test-Path $winmd) { Add-Type -Path $winmd -ErrorAction Stop | Out-Null }
    $smTCType = [Type]::GetType('Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime')
  }
  if ($null -eq $smTCType) { throw 'WinRT type Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager could not be resolved (tried System.Runtime.WindowsRuntime + Windows.Media.Control.winmd)' }
} catch {
  $winrtLoadError = $_.Exception.Message
  $smTCType = $null
}
try {
  if ($null -eq $smTCType) { Write-Error "WinRT SMTC type unavailable: $winrtLoadError"; exit 1 }
  $mgr = $smTCType::RequestAsync().GetAwaiter().GetResult()
  if (-not $SessionId) { Write-Error 'media-control needs a session id (per-session control only; no GetCurrentSession fallback)'; exit 1 }
  $s = $null
  foreach ($cand in $mgr.GetSessions()) {
    $aumid = $cand.SourceAppUserModelId
    if ($aumid -and $aumid -eq $SessionId) { $s = $cand; break }
    if ($SessionId -like 'title:*') {
      $t = $cand.TryGetMediaPropertiesAsync().GetAwaiter().GetResult()
      if ($t -and ('title:' + $t.Title) -eq $SessionId) { $s = $cand; break }
    }
  }
  if (-not $s) { Write-Error "session not found: $SessionId"; exit 1 }
  switch ($Cmd) {
    'toggle'   { $s.TryTogglePlayPauseAsync().GetAwaiter().GetResult() | Out-Null }
    'next'     { $s.TrySkipNextAsync().GetAwaiter().GetResult() | Out-Null }
    'previous' { $s.TrySkipPreviousAsync().GetAwaiter().GetResult() | Out-Null }
    'play'     { $s.TryPlayAsync().GetAwaiter().GetResult() | Out-Null }
    'pause'    { $s.TryPauseAsync().GetAwaiter().GetResult() | Out-Null }
    'seek'     {
      if ($Value -lt 0) { Write-Error 'seek needs a position in seconds (>= 0)'; exit 1 }
      $ok = $s.TryChangePlaybackPositionAsync([TimeSpan]::FromSeconds($Value)).GetAwaiter().GetResult()
      if (-not $ok) { Write-Error 'seek was refused by the session'; exit 1 }
    }
    default    { Write-Error "unknown command: $Cmd"; exit 1 }
  }
  Write-Output "ok"
} catch { Write-Error $_.Exception.Message; exit 1 }
