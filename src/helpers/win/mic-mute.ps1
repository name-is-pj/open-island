# Usage: mic-mute.ps1 <mute|unmute> - mutes the DEFAULT CAPTURE device via Core Audio (IAudioEndpointVolume).
# v1-partial: this uses a C# COM shim around MMDeviceEnumerator. If the shim fails on a machine,
# the main process reports the failure honestly instead of pretending the mic is muted.
# v1.0.0 (item B): the old interface declared SetMute at vtable index 6 -
# that slot is GetMasterVolumeLevelScalar, NOT SetMute (SetMute is index 12:
# Register, Unregister, GetChannelCount, SetMasterVolumeLevel,
# SetMasterVolumeLevelScalar, GetMasterVolumeLevel, GetMasterVolumeLevelScalar,
# GetChannelVolumeLevel, SetChannelVolumeLevel, GetChannelVolumeLevelScalar,
# SetChannelVolumeLevelScalar, GetMute, SetMute). So the old code called the
# wrong method, printed "ok", and never muted anything - while the UI showed
# "Muted" from local state. The interface below has the full correct vtable
# and the script VERIFIES by reading GetMute back before reporting success.
param([string]$Cmd)
$code = @'
using System; using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
# IID_IMMDeviceEnumerator per mmdeviceapi.h: A95664D2-9614-4F35-A746-DE8DB63617E6.
# BCDE0395 is the CLSID (class), NOT the interface IID - using it as the IID
# makes QueryInterface fail E_NOINTERFACE (PJ's v5.0.3 log, 02:47:30).
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int NotImpl1(); [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface); }
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int NotImpl0(); int NotImpl1(); int NotImpl2(); int NotImpl3(); int NotImpl4(); int NotImpl5();
  int NotImpl6(); int NotImpl7(); int NotImpl8(); int NotImpl9(); int NotImpl10();
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid eventContext);
}
public static class MicMute {
  private static IAudioEndpointVolume Endpoint() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev; en.GetDefaultAudioEndpoint(1, 1, out dev); // 1 = eCapture, 1 = eCommunications
    Guid iid = typeof(IAudioEndpointVolume).GUID; object o; dev.Activate(ref iid, 23, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }
  public static bool Get() {
    bool mute; int hr = Endpoint().GetMute(out mute);
    if (hr != 0) throw new COMException("GetMute failed", hr);
    return mute;
  }
  public static void Set(bool mute) {
    Guid ctx = Guid.Empty; int hr = Endpoint().SetMute(mute, ref ctx);
    if (hr != 0) throw new COMException("SetMute failed", hr);
  }
}
'@
try {
  Add-Type -TypeDefinition $code -ErrorAction Stop
  [MicMute]::Set($Cmd -eq 'mute')
  Start-Sleep -Milliseconds 300
  $isMuted = [MicMute]::Get()
  if ($isMuted -ne ($Cmd -eq 'mute')) { Write-Error 'mic mute did not change'; exit 1 }
  Write-Output "ok"
} catch { Write-Error $_.Exception.Message; exit 1 }
