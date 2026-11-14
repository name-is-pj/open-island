# GPU name + 3D-engine utilisation via performance counters. Returns JSON.
# v3.0.0 diagnosis (item 17): the old script tried exactly ONE counter path,
# '\GPU Engine(*engtype_3D)\Utilization Percentage'. On machines whose driver
# exposes no engtype_3D counter instances (some integrated GPUs, older
# drivers, or a counter that has not initialised yet) Get-Counter throws and
# the script fell through to {"load":null} - so the strip and Widgets showed
# "GPU -" even though a GPU was present. getStats (main.js) already calls
# this helper every 2s and the strip already renders s.gpu.load, so the value
# was never failing to reach the UI - the counter lookup itself was failing.
# Fix: try the 3D path first, then the broad '\GPU Engine(*)\Utilization
# Percentage' (max across all engines), then a two-sample read of the broad
# path (a counter's first sample can be 0/uninitialised). A null load now
# also carries a note saying why, instead of failing silently. FPS is NOT
# measured here - it stays "-" when no game is presenting (honest).
try {
  $name = (Get-CimInstance Win32_VideoController -ErrorAction Stop | Select-Object -First 1).Name
  $load = $null
  $paths = @('\GPU Engine(*engtype_3D)\Utilization Percentage', '\GPU Engine(*)\Utilization Percentage')
  foreach ($p in $paths) {
    try {
      $c = Get-Counter $p -ErrorAction Stop
      $vals = @($c.CounterSamples | Where-Object { $null -ne $_.CookedValue } | ForEach-Object { $_.CookedValue })
      if ($vals.Count -gt 0) { $load = ($vals | Measure-Object -Maximum).Maximum; break }
    } catch { continue }
  }
  if ($null -eq $load) {
    # Last resort: a two-sample read - the first sample of a fresh counter
    # can be uninitialised/0 even when the counter exists.
    try {
      $c = Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples 2 -ErrorAction Stop
      $second = $c.CounterSamples | Where-Object { $_.Timestamp -eq ($c.CounterSamples | Select-Object -Last 1).Timestamp }
      $vals = @($second | Where-Object { $null -ne $_.CookedValue } | ForEach-Object { $_.CookedValue })
      if ($vals.Count -gt 0) { $load = ($vals | Measure-Object -Maximum).Maximum }
    } catch { /* still null - reported honestly below */ }
  }
  if ($null -eq $load) {
    [pscustomobject]@{ name = $name; load = $null; note = 'GPU counter unavailable on this machine (no usable GPU Engine counter)' } | ConvertTo-Json -Compress
  } else {
    [pscustomobject]@{ name = $name; load = [math]::Round($load) } | ConvertTo-Json -Compress
  }
} catch {
  try { $name = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name; "{`"name`": `"$name`", `"load`": null, `"note`": `"GPU counter unavailable on this machine`"}" }
  catch { '{"name":null,"load":null,"note":"GPU counter unavailable on this machine"}' }
}
