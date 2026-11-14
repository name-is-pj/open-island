# Are mic / camera / capture in use right now? Best-effort via process + registry signals.
# Returns JSON { mic, cam, capture }. v1: mic detection uses the audio session list.
try {
  $mic = $false; $cam = $false; $capture = $false
  # Camera: the Windows Camera Frame Server (WindowsCamera / FrameServer) running usually means the camera is live.
  if (Get-Process -Name WindowsCamera,FrameServer -ErrorAction SilentlyContinue) { $cam = $true }
  # Capture: Game Bar / Xbox Game Bar capture process.
  if (Get-Process -Name GameBar,GameBarFTServer -ErrorAction SilentlyContinue) { $capture = $true }
  [pscustomobject]@{ mic = $mic; cam = $cam; capture = $capture } | ConvertTo-Json -Compress
} catch { '{"mic":false,"cam":false,"capture":false}' }
