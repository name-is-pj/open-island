# System power state (for the live-wallpaper battery rules + battery pop-ups).
# Returns JSON: { acOnline, saverOn, batteryPct } - no Windows permission needed.
try {
  $src = @'
using System;
using System.Runtime.InteropServices;
public static class PW {
  [StructLayout(LayoutKind.Sequential)]
  public struct SPS { public byte ACLineStatus; public byte BatteryFlag; public byte BatteryLifePercent; public byte SystemStatusFlag; public uint BatteryLifeTime; public uint BatteryFullLifeTime; }
  [DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out SPS s);
}
'@
  Add-Type -TypeDefinition $src -ErrorAction Stop | Out-Null
  $s = New-Object PW+SPS
  if (-not [PW]::GetSystemPowerStatus([ref]$s)) { '{"ok":false,"error":"GetSystemPowerStatus failed"}'; exit 0 }
  [pscustomobject]@{
    ok = $true
    acOnline = $s.ACLineStatus -eq 1
    saverOn = ($s.SystemStatusFlag -band 1) -eq 1
    batteryPct = if ($s.BatteryLifePercent -eq 255) { $null } else { [int]$s.BatteryLifePercent }
  } | ConvertTo-Json -Compress
} catch { '{"ok":false,"error":"power check failed: ' + ($_.Exception.Message -replace '"', "'") + '"}' }
