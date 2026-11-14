# Usage: nightlight.ps1 <true|false> - toggles Night Light.
# The state lives in a binary CloudStore blob (see net-state.ps1): byte 24,
# bit 0 = on. The toggle flips that bit and writes the blob back, then
# re-reads it to VERIFY the bit stuck before reporting success.
# v5.0.0: the old version always errored ("v1-partial") - the tile was a
# dead button. If the blob cannot be found, written, or verified on this
# machine, the script exits 1 with an honest error and the renderer opens
# Windows Night Light settings instead of pretending the toggle worked.
# Never a fake success.
param([string]$Arg)
try {
  if ($Arg -ne 'true' -and $Arg -ne 'false') { Write-Error "unknown command: $Arg (use true | false)"; exit 1 }
  $wantOn = ($Arg -eq 'true')
  $p = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CloudStore\Store'
  $keys = @(Get-ChildItem -Path $p -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'bluelightreduction' })
  $target = $null; $data = $null
  foreach ($key in $keys) {
    try {
      $d = (Get-ItemProperty -Path $key.PSPath -Name Data -ErrorAction Stop).Data
      if ($d -and $d.Length -gt 24) { $target = $key; $data = $d; break }
    } catch { continue }
  }
  if (-not $target) { Write-Error 'night light setting not found on this machine'; exit 1 }
  if ($wantOn) { $data[24] = $data[24] -bor 1 } else { $data[24] = $data[24] -band (-bnot 1) }
  Set-ItemProperty -Path $target.PSPath -Name Data -Value $data -ErrorAction Stop
  Start-Sleep -Milliseconds 400
  $check = (Get-ItemProperty -Path $target.PSPath -Name Data -ErrorAction Stop).Data
  $isOn = (($check[24] -band 1) -eq 1)
  if ($isOn -ne $wantOn) { Write-Error 'night light did not change'; exit 1 }
  Write-Output 'ok'
} catch { Write-Error $_.Exception.Message; exit 1 }
