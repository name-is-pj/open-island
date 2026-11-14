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
# Never throws: on any failure it prints {"sessions":[]} so the island shows
# its honest empty state instead of crashing.
Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue | Out-Null

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
  $mgr = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync().GetAwaiter().GetResult()
  $list = @()
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
    } catch { continue }
  }
  @{ sessions = @($list) } | ConvertTo-Json -Compress -Depth 4
} catch { '{"sessions":[]}' }
