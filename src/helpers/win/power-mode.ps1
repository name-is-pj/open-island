# Windows power plan (Balanced / Power saver / High performance) via powercfg.
# Usage: power-mode.ps1 <get|set> [balanced|performance|saver]
# GUIDs: Balanced 381b4222-f694-41f0-9685-ff5bb260df2e
#        Power saver a1841308-3541-4fab-bc81-f71556f20b4a
#        High performance 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c
param([string]$Cmd = 'get', [string]$Mode = '')
try {
  $guids = @{ balanced = '381b4222-f694-41f0-9685-ff5bb260df2e'; saver = 'a1841308-3541-4fab-bc81-f71556f20b4a'; performance = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' }
  if ($Cmd -eq 'set') {
    $g = $guids[$Mode]
    if (-not $g) { '{"ok":false,"error":"unknown mode"}'; exit 0 }
    powercfg /setactive $g | Out-Null
    '{"ok":true,"mode":"' + $Mode + '"}'; exit 0
  }
  $out = powercfg /getactivescheme
  $m = [regex]::Match($out, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
  $mode = 'unknown'
  foreach ($k in $guids.Keys) { if ($guids[$k] -eq $m.Value) { $mode = $k } }
  '{"ok":true,"mode":"' + $mode + '"}'
} catch { '{"ok":false,"error":"power-mode check failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
