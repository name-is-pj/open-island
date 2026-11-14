# Enumerate ALL Windows System Media Transport Controls sessions (SMTC).
# v2.0.0: GetSessions() - not just GetCurrentSession() - so every app that is
# playing audio shows up: YouTube in Chrome/Edge, Spotify, VLC, any app.
# Returns JSON: { "sessions": [ { id, app, title, artist, album, status,
#   position, duration, artwork } ] }
#   id      = SourceAppUserModelId when the app has one, else "title:<title>"
#             (the renderer passes this id back to media-control.ps1).
#   app     = friendly app name (Spotify, Chrome, Edge, VLC, ...).
#   status  = Playing | Paused | Stopped | Closed | Changing (raw enum string).
#   artwork = data-URL thumbnail when cheap to get (small stream only), else "".
# Sessions with no title are skipped ONLY when there is no AUMID either
# (a truly stale/empty session). Chrome's session is briefly title-less on
# track transitions and is deleted ~0.8-1s after a skip - a session with an
# AUMID is kept even with an empty title (the app name is shown instead),
# and main.js adds a ~1.5s grace period before dropping a vanished session.
# v1.0.2: failures are REPORTED, never silent. The old version printed
# {"sessions":[]} on any failure, so a failed WinRT call was invisible:
# the log had zero media.ps1 failures while the panel showed "No media
# playing" for a Spotify session playing in Chrome. Now the outer catch
# prints {"sessions":[],"error":"<real message>"} (pollMedia surfaces it
# as mediaState.error -> the renderer shows "Media unavailable"), and a
# per-session failure is counted and reported as "skipped" (see below).
# The empty state stays honest: only a successful check with zero
# sessions shows "No media playing".
# v1.0.3: the WinRT SMTC type must actually RESOLVE before it is used.
# The old first line loaded System.Runtime.WindowsRuntime with
# -ErrorAction SilentlyContinue, which hid the load failure - and the
# literal [Windows.Media.Control...] reference then died with "Unable to
# find type" on every call (v1.0.2 log openisland-5.log, 5 times), so no
# media session was ever listed. Resolve the type explicitly:
# assembly-qualified WinRT name first, then the WinMD file directly. If
# it still cannot resolve, $smTCType stays $null and the main try throws
# with the REAL reason (surfaced as mediaState.error), never a silent
# empty session list.
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

function Get-AppName([string]$aumid) {
  if (-not $aumid) { return 'Unknown app' }
  $l = $aumid.ToLowerInvariant()
  if ($l -match 'spotify') { return 'Spotify' }
  if ($l -match 'chrome') { return 'Chrome' }
  if ($l -match 'edge') { return 'Edge' }
  if ($l -match 'firefox') { return 'Firefox' }
  if ($l -match 'vlc') { return 'VLC' }
  if ($l -match 'applemusic|itunes') { return 'Apple Music' }
  if ($l -match 'youtubemusic') { return 'YouTube Music' }
  if ($l -match 'netflix') { return 'Netflix' }
  if ($l -match 'whatsapp') { return 'WhatsApp' }
  if ($l -match 'zoom') { return 'Zoom' }
  if ($l -match 'wmplayer|mediaplayer') { return 'Media Player' }
  $short = ($aumid -split '_')[0]
  return ($short -split '\.')[0]
}

function Get-Artwork([object]$props) {
  try {
    $thumb = $props.Thumbnail
    if (-not $thumb) { return '' }
    $stream = $thumb.OpenReadAsync().GetAwaiter().GetResult()
    if (-not $stream -or $stream.Size -le 0 -or $stream.Size -gt 524288) { return '' }
    $reader = New-Object Windows.Storage.Streams.DataReader($stream)
    [void]$reader.LoadAsync([uint32]$stream.Size).GetAwaiter().GetResult()
    $bytes = New-Object byte[] $stream.Size
    $reader.ReadBytes($bytes)
    $reader.Dispose(); $stream.Dispose()
    $mime = 'image/png'
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8 -and $bytes[2] -eq 0xFF) { $mime = 'image/jpeg' }
    elseif ($bytes.Length -ge 4 -and $bytes[0] -eq 0x47 -and $bytes[1] -eq 0x49 -and $bytes[2] -eq 0x46) { $mime = 'image/gif' }
    return "data:$mime;base64," + [Convert]::ToBase64String($bytes)
  } catch { return '' }
}

try {
  if ($null -eq $smTCType) { throw "WinRT SMTC type unavailable: $winrtLoadError" }
  $mgr = $smTCType::RequestAsync().GetAwaiter().GetResult()
  $list = @()
  $skipped = 0
  foreach ($s in $mgr.GetSessions()) {
    try {
      $aumid = $s.SourceAppUserModelId
      $props = $s.TryGetMediaPropertiesAsync().GetAwaiter().GetResult()
      # Keep the session when it has an AUMID even if the title is briefly
      # empty (Chrome on transitions); skip only title-less AND app-less.
      if ((-not $props -or [string]::IsNullOrWhiteSpace($props.Title)) -and [string]::IsNullOrWhiteSpace($aumid)) { continue }
      $title = if ($props) { $props.Title } else { '' }
      $artist = if ($props) { $props.Artist } else { '' }
      $album = if ($props) { $props.AlbumTitle } else { '' }
      $info = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      $id = if ($aumid) { $aumid } else { 'title:' + $title }
      $list += [pscustomobject]@{
        id = $id; app = Get-AppName $aumid
        title = $title; artist = $artist; album = $album
        status = "$($info.PlaybackStatus)"
        position = [double]($tl.Position.TotalSeconds); duration = [double]($tl.EndTime.TotalSeconds)
        artwork = if ($props) { Get-Artwork $props } else { '' }
      }
    } catch { $skipped++; continue }
  }
  # A session that throws inside TryGetMediaProperties / GetPlaybackInfo is
  # counted, not silently dropped: "skipped" is in the payload when > 0,
  # so the log (via pollMedia) shows a session existed but could not be read.
  $out = @{ sessions = @($list) }
  if ($skipped -gt 0) { $out.skipped = $skipped }
  $out | ConvertTo-Json -Compress -Depth 4
} catch { '{"sessions":[],"error":"media check failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
