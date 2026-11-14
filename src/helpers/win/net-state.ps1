# Current states for the Controls tiles (read-only; toggles live in net-toggle.ps1 etc.).
# Usage: net-state.ps1 <wifi|bluetooth|nightlight>
# Returns {"ok":true,"on":true|false} or {"ok":false,"error":...} when unknown.
param([string]$What)
try {
  switch ($What) {
    'wifi' {
      # v5.0.0: the WinRT radio state is the primary source - it reports the
      # Wi-Fi RADIO (on/off), which is what the tile toggles. The old single
      # netsh line broke on machines with MULTIPLE wireless interfaces
      # (virtual/hotspot adapters): Select-String returns every "State:"
      # line and the old code read the wrong one's value.
      $on = $null
      try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop | Out-Null
        $radios = [Windows.Devices.Radios.Radio]::GetRadiosAsync().GetAwaiter().GetResult()
        $w = $radios | Where-Object { $_.Kind -eq 'WiFi' } | Select-Object -First 1
        if ($w) { $on = ($w.State -eq 'On') }
      } catch { $on = $null }
      if ($null -eq $on) {
        # Fallback: netsh, parsed interface by interface - connected if ANY
        # interface's State is connected. No wireless interface at all is
        # honestly unknown, not "off".
        $out = netsh wlan show interfaces
        if ($LASTEXITCODE -ne 0 -or -not $out) { '{"ok":false,"error":"no wireless interface found"}'; exit 0 }
        $states = @($out | Select-String '^\s*State\s*:\s*(.+)$' | ForEach-Object { $_.Matches.Groups[1].Value.Trim() })
        if ($states.Count -eq 0) { '{"ok":false,"error":"no wireless interface found"}'; exit 0 }
        # NOTE: exact match (-contains), NOT -match 'connected' - the state
        # word "disconnected" CONTAINS "connected" as a substring and would
        # read as connected.
        $on = ($states -contains 'connected')
      }
      '{"ok":true,"on":' + $(if ($on) { 'true' } else { 'false' }) + '}'
    }
    'bluetooth' {
      Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop | Out-Null
      $radios = [Windows.Devices.Radios.Radio]::GetRadiosAsync().GetAwaiter().GetResult()
      $bt = $radios | Where-Object { $_.Kind -eq 'Bluetooth' } | Select-Object -First 1
      if (-not $bt) { '{"ok":false,"error":"no Bluetooth radio found"}'; exit 0 }
      '{"ok":true,"on":' + $(if ($bt.State -eq 'On') { 'true' } else { 'false' }) + '}'
    }
    'nightlight' {
      # Night Light state lives in a binary CloudStore blob; the community-known
      # check is byte 24 (bit 0 = on).
      # v5.0.0: the lookup is robust - it searches EVERY CloudStore key for
      # 'bluelightreduction' (the exact subkey path differs across builds,
      # including Insider builds) and reads the first blob that is long
      # enough. A missing or too-short blob is honestly unknown.
      $p = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CloudStore\Store'
      $keys = @(Get-ChildItem -Path $p -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'bluelightreduction' })
      $on = $null
      foreach ($key in $keys) {
        try {
          $data = (Get-ItemProperty -Path $key.PSPath -Name Data -ErrorAction Stop).Data
          if ($data -and $data.Length -gt 24) { $on = (($data[24] -band 1) -eq 1); break }
        } catch { continue }
      }
      if ($null -eq $on) { '{"ok":false,"error":"night light state not found"}'; exit 0 }
      '{"ok":true,"on":' + $(if ($on) { 'true' } else { 'false' }) + '}'
    }
    default { '{"ok":false,"error":"unknown state"}' }
  }
} catch { '{"ok":false,"error":"' + ($_.Exception.Message -replace '"', "'") + '"}' }
