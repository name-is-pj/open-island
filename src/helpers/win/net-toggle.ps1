# Usage: net-toggle.ps1 <wifi|bluetooth> <1|0>
# Toggles the radio and VERIFIES the new state before reporting success -
# the old Wi-Fi path printed "ok" unconditionally while running
# `netsh wlan set autoconfig` against a hardcoded "Wi-Fi" interface name
# (wrong on machines where the adapter is named differently, and autoconfig
# does not even switch the radio off). Never a fake success: if the state
# did not change, the script exits 1 with an honest error and the tile
# keeps its previous state (the renderer then offers the Windows setting).
# v1.0.0 (item B, LOG-PROVEN): the old param was [bool]$On, and on PJ's
# machine PowerShell's [bool] parameter binding from command-line strings
# received the literal string "System.String" instead of true/false (log
# 02:47:38: "Cannot convert value \"System.String\" to type
# \"System.Boolean\""). The mechanism is not derivable from the code - so
# this script NEVER relies on [bool] binding from argv again: it takes
# [string]$OnRaw and parses it defensively ('1'/'true'/'$true' = on,
# '0'/'false'/'$false' = off; anything else errors honestly, NAMING the
# value received). The app passes '1'/'0'. A [string] parameter receives
# the value as-is - no conversion, nothing to mangle.
param([string]$What, [string]$OnRaw)
$On = $null
switch ($OnRaw) {
  '1' { $On = $true }
  'true' { $On = $true }
  '$true' { $On = $true }
  '0' { $On = $false }
  'false' { $On = $false }
  '$false' { $On = $false }
  default { Write-Error "unknown on/off value: '$OnRaw' (use 1 | 0)"; exit 1 }
}
function Get-RadioState([string]$Kind) {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop | Out-Null
  $radios = [Windows.Devices.Radios.Radio]::GetRadiosAsync().GetAwaiter().GetResult()
  $r = $radios | Where-Object { $_.Kind -eq $Kind } | Select-Object -First 1
  if (-not $r) { return $null }
  return @{ Radio = $r; On = ($r.State -eq 'On') }
}
try {
  if ($What -eq 'wifi') {
    $st = $null
    try { $st = Get-RadioState 'WiFi' } catch { $st = $null }
    if ($st) {
      $st.Radio.SetStateAsync($(if ($On) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off })).GetAwaiter().GetResult() | Out-Null
      Start-Sleep -Milliseconds 600
      $after = Get-RadioState 'WiFi'
      if ($after -and $after.On -eq $On) { Write-Output 'ok'; exit 0 }
      Write-Error "Wi-Fi radio did not change state"; exit 1
    }
    # Fallback (no WinRT radio exposed): enable/disable the real interface
    # by its actual name from netsh - never a hardcoded "Wi-Fi".
    $out = netsh wlan show interfaces
    $name = ($out | Select-String '^\s*Name\s*:\s*(.+)$' | Select-Object -First 1).Matches.Groups[1].Value.Trim()
    if (-not $name) { Write-Error 'no wireless interface found'; exit 1 }
    netsh interface set interface "$name" admin=$(if ($On) { 'enable' } else { 'disable' }) | Out-Null
    Start-Sleep -Milliseconds 600
    $again = netsh wlan show interfaces
    $states = @($again | Select-String '^\s*State\s*:\s*(.+)$' | ForEach-Object { $_.Matches.Groups[1].Value.Trim() })
    # NOTE: exact match (-contains), NOT -match 'connected' - the state
    # word "disconnected" CONTAINS "connected" as a substring.
    $connected = ($states -contains 'connected')
    # Enabling: the radio is on when an interface reports again; disabling:
    # no interface may report at all (disconnected is the expected state).
    if ($On -and $states.Count -eq 0) { Write-Error 'Wi-Fi did not come back on'; exit 1 }
    if (-not $On -and $connected) { Write-Error 'Wi-Fi is still connected'; exit 1 }
    Write-Output 'ok'
  } elseif ($What -eq 'bluetooth') {
    # Bluetooth radio toggle needs the Windows.Devices.Radios API; use bthprops via registry-free WinRT:
    $st = Get-RadioState 'Bluetooth'
    if (-not $st) { Write-Error 'no Bluetooth radio found'; exit 1 }
    $st.Radio.SetStateAsync($(if ($On) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off })).GetAwaiter().GetResult() | Out-Null
    Start-Sleep -Milliseconds 600
    $after = Get-RadioState 'Bluetooth'
    if ($after -and $after.On -eq $On) { Write-Output 'ok'; exit 0 }
    Write-Error 'Bluetooth radio did not change state'; exit 1
  }
} catch { Write-Error $_.Exception.Message; exit 1 }
