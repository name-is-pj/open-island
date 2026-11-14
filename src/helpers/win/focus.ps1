# Usage: focus.ps1 <get|true|false> - Do Not Disturb (Focus) state/toggle.
# Windows 11 has NO public WinRT toggle API for Do Not Disturb, and the
# old "QuietHours" registry value the v1 code read does not exist on
# Windows 11. The real, working mechanism is the notification-settings
# value NOC_GLOBAL_SETTING_TOASTS_ENABLED under
# HKCU\...\Notifications\Settings: 0 = toasts disabled (Do Not Disturb on),
# 1 = toasts enabled (off). (The on/off state itself also lives in the
# CloudStore $$windows.data.notifications.quiethourssettings blob, but its
# byte layout is undocumented and varies by build - the registry value is
# the reliable read/write path.)
#   get:   {"ok":true,"on":true|false} when the value can be read, else
#          {"ok":false,"error":"..."} - never a fake value.
#   true/false (toggle): writes the value and VERIFIES it by re-reading;
#          exits 1 honestly when the write did not stick (the renderer
#          then opens Windows notification settings instead of a dead tile).
param([string]$Arg)
function Get-DndState {
  $p = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
  $v = Get-ItemProperty -Path $p -Name 'NOC_GLOBAL_SETTING_TOASTS_ENABLED' -ErrorAction SilentlyContinue
  if ($null -ne $v -and $null -ne $v.NOC_GLOBAL_SETTING_TOASTS_ENABLED) {
    return @{ On = ($v.NOC_GLOBAL_SETTING_TOASTS_ENABLED -eq 0) }
  }
  $d = Get-ItemProperty -Path $p -Name 'NOC_GLOBAL_SETTING_DND' -ErrorAction SilentlyContinue
  if ($null -ne $d -and $null -ne $d.NOC_GLOBAL_SETTING_DND) {
    return @{ On = ($d.NOC_GLOBAL_SETTING_DND -ne 0) }
  }
  return $null
}
try {
  if ($Arg -eq 'get') {
    $st = Get-DndState
    if ($null -eq $st) {
      '{"ok":false,"error":"Do Not Disturb state is not exposed by this Windows build"}'
    } else {
      '{"ok":true,"on":' + $(if ($st.On) { 'true' } else { 'false' }) + '}'
    }
    exit 0
  }
  if ($Arg -eq 'true' -or $Arg -eq 'false') {
    $wantOn = ($Arg -eq 'true')
    $p = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
    # 0 = toasts disabled (DND on), 1 = toasts enabled (DND off).
    Set-ItemProperty -Path $p -Name 'NOC_GLOBAL_SETTING_TOASTS_ENABLED' -Value $(if ($wantOn) { 0 } else { 1 }) -Type DWord -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 400
    $st = Get-DndState
    if ($null -eq $st -or $st.On -ne $wantOn) {
      Write-Error 'Do Not Disturb did not change'; exit 1
    }
    Write-Output 'ok'
    exit 0
  }
  Write-Error "unknown command: $Arg (use get | true | false)"; exit 1
} catch { Write-Error $_.Exception.Message; exit 1 }
