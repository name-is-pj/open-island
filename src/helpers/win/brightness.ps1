# Usage: brightness.ps1 get | brightness.ps1 set <0-100>
# Reads/sets the internal display brightness via WMI (WmiMonitorBrightness).
# v3.0.0 fix: the old get assumed a monitor instance always exists - on a
# desktop / external-monitor-only machine Get-CimInstance returns nothing and
# "$($b.CurrentBrightness)" expanded to empty, producing invalid JSON
# ({"level": }) which main.js could only report as "bad JSON from helper" and
# the Controls slider showed "-" with no reason. Now a missing monitor (or
# any WMI failure) returns an honest {"level":null,"error":"..."} - never a
# fake number. Brightness control genuinely does not exist on most desktops.
param([string]$Cmd, [int]$Level = 0)
try {
  if ($Cmd -eq 'get') {
    $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
    if (-not $b -or $null -eq $b.CurrentBrightness) {
      '{"level":null,"error":"no internal display brightness control found (desktop or external monitor - WmiMonitorBrightness returned no monitor)"}'
    } else {
      "{`"level`": $($b.CurrentBrightness)}"
    }
  } elseif ($Cmd -eq 'set') {
    $ms = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
    if (-not $ms) { Write-Error 'no internal display brightness control found (desktop or external monitor)'; exit 1 }
    Invoke-CimMethod -InputObject $ms -MethodName WmiSetBrightness -Arguments @{ Brightness = $Level; Timeout = 0 } | Out-Null
    Write-Output "ok"
  } else {
    Write-Error "unknown command: $Cmd (use get | set <0-100>)"; exit 1
  }
} catch { Write-Error $_.Exception.Message; exit 1 }
