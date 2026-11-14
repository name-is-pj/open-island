# Network throughput (up/down B/s) for the Widgets stats card.
# Uses the built-in Network Interface performance counters (no admin needed).
try {
  $c = Get-Counter '\Network Interface(*)\Bytes Received/sec', '\Network Interface(*)\Bytes Sent/sec' -ErrorAction Stop
  $down = 0; $up = 0
  foreach ($s in $c.CounterSamples) {
    if ($s.InstanceName -match 'Loopback|isatap|Teredo') { continue }
    if ($s.Path -match 'Received') { $down += $s.CookedValue } else { $up += $s.CookedValue }
  }
  '{"ok":true,"down":' + [math]::Round($down) + ',"up":' + [math]::Round($up) + '}'
} catch { '{"ok":false,"error":"network counters unavailable: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
