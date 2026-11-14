# Report the DWM composition rate (a real FPS proxy, nothing injected).
# DwmFlush() blocks until the compositor presents the next frame, so calling
# it N times and measuring the elapsed time gives the rate at which Windows is
# composing frames. A borderless/windowed game presenting frames drives that
# rate; when nothing is presenting, DwmFlush returns immediately and we
# report null (no game) instead of inventing a number. A game using
# independent flip bypasses the compositor and also reads as null - that is
# an honest limit of measuring without injection, not a bug.
# Usage: fps.ps1 [samples]  (default 16 flushes)
param([int]$Samples = 16)
try {
  $src = @'
using System;
using System.Runtime.InteropServices;
public static class DW {
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
}
'@
  Add-Type -TypeDefinition $src -ErrorAction Stop | Out-Null
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  for ($i = 0; $i -lt $Samples; $i++) { [void][DW]::DwmFlush() }
  $sw.Stop()
  $elapsed = $sw.Elapsed.TotalSeconds
  # Idle compositor: flushes return in <3ms each - nothing is presenting.
  if ($elapsed -lt ($Samples * 0.003)) { '{"fps":null,"note":"compositor idle - no game presenting"}'; exit 0 }
  $fps = [math]::Round($Samples / $elapsed)
  if ($fps -lt 5 -or $fps -gt 1000) { '{"fps":null,"note":"implausible rate"}'; exit 0 }
  '{"fps":' + $fps + ',"note":"DWM composition rate"}'
} catch { '{"fps":null,"error":"fps check failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
