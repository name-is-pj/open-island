# Audio endpoints (headphones connect/disconnect detection for pop-ups).
# Returns the currently present audio endpoints: {ok, devices:[{name, id}]}.
# Battery level is NOT exposed by any stable Win32/PowerShell API for
# Bluetooth headphones (it needs the Bluetooth GATT battery service), so it
# is deliberately not faked here - the pop-up shows the device name only.
try {
  $devs = Get-PnpDevice -Class AudioEndpoint -Status OK -ErrorAction Stop |
    Select-Object -ExpandProperty FriendlyName -Unique
  $items = @()
  foreach ($d in $devs) { $items += [pscustomobject]@{ name = $d } }
  [pscustomobject]@{ ok = $true; devices = $items } | ConvertTo-Json -Compress -Depth 3
} catch { '{"ok":false,"error":"audio endpoint list unavailable: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
