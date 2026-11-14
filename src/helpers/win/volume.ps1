# Usage: volume.ps1 get | volume.ps1 set <0-100> [from-level]
# v3.0.0: real master-volume get/set via the Core Audio COM shim below
# (MMDeviceEnumerator + IAudioEndpointVolume). The v1/v2 version always
# returned {"level":null} for get and could not set at all, so the Controls
# slider showed "-". Never a fake number: on failure get returns
# {"level":null,"error":"..."} and set exits 1 with the error.
# v5.0.0: the Core Audio calls now run on a dedicated STA thread.
# PowerShell itself runs MTA, and MMDeviceEnumerator activation is the
# likely failure on machines where get AND set both fail (brightness, which
# uses WMI, works on the same machine). If the STA attempt fails, the
# script falls back to a direct (MTA) attempt before giving up honestly.
# v1.0.0 (item B): if the COM shim fails entirely, set falls back to the
# volume keys (keybd_event, VK_VOLUME_UP/DOWN - plain user32, no COM) and
# reports {"ok":true,"level":<reached>,"via":"keys"}. The optional
# [from-level] (the app's last-known level, -1 when unknown) tells the keys
# how far to move; unknown means down-to-0 first, then up to the target.
# v1.0.0 (item B, LOG-PROVEN): IMMDeviceEnumerator's interface was declared
# with Guid BCDE0395-E52F-467C-8E3D-C4579291692E - that is the COCLASS CLSID
# (CLSID_MMDeviceEnumerator), NOT the interface IID. The runtime therefore
# attempted QueryInterface with BCDE0395 and the object rejected it:
# "QueryInterface call ... for the interface with IID '{BCDE0395...}' failed
# ... No such interface supported" (E_NOINTERFACE, HRESULT 0x80004002) on
# PJ's machine (log 02:47:30), so every get/set failed and the slider showed
# "Unavailable". The true IID is A95664D2-9614-4F35-A746-DE8DB63617E6
# (mmdeviceapi.h / winapi um::mmdeviceapi, verified 2026-11-14 against the
# winapi crate source, the Pelles C mmdeviceapi.h quote, go-wca and the
# Delphi TGUID listing - all agree). CORRECTION: the earlier "[ComImport]"
# diagnosis was WRONG - QI was attempted, so [ComImport] was never the
# blocker; it is kept because it is the standard declaration. BCDE0395 stays
# correct in the CreateInstance call below - that IS the CLSID for creating
# the object. IID verification (winapi crate, generated from the SDK headers):
#   CLSID_MMDeviceEnumerator  BCDE0395-E52F-467C-8E3D-C4579291692E (class)
#   IID_IMMDeviceEnumerator   A95664D2-9614-4F35-A746-DE8DB63617E6
#   IID_IMMDevice             D666063F-1587-4E43-81F1-B948E807363F
#   IID_IAudioEndpointVolume  5CDF2C82-841E-4546-9722-0CF74078229A
# IMMDeviceEnumerator's vtable is declared in full (EnumAudioEndpoints,
# GetDefaultAudioEndpoint, GetDevice - GetDevice was missing; a call past a
# short vtable would hit the wrong slot). IMMDevice declares only Activate
# (slot 0) and IAudioEndpointVolume slots 0-6 in order, which were already correct.
# The keybd_event set fallback below stays as belt-and-braces, but this
# COM fix is the real fix for GET (the level read) - the keys cannot read.
# IAudioEndpointVolume vtable order verified against the documented
# interface: Register, Unregister, GetChannelCount, SetMasterVolumeLevel,
# SetMasterVolumeLevelScalar, GetMasterVolumeLevel, GetMasterVolumeLevelScalar.
param([string]$Cmd, [int]$Level = 0, [int]$From = -1)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
  [PreserveSig] int GetDevice(string pwstrId, out IMMDevice ppDevice);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  [PreserveSig] int Activate([MarshalAs(UnmanagedType.LPStruct)] Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
  [PreserveSig] int GetChannelCount(out uint pnChannelCount);
  [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
  [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
  [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
}
public static class Vol {
  private const int CLSCTX_ALL = 23; // CLSCTX_INPROC_SERVER|INPROC_HANDLER|LOCAL_SERVER|REMOTE_SERVER
  private static IAudioEndpointVolume Endpoint() {
    var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
    IMMDevice device;
    int hr = enumerator.GetDefaultAudioEndpoint(0, 0, out device); // eRender, eConsole
    if (hr != 0 || device == null) throw new COMException("no default audio endpoint", hr);
    object ep;
    hr = device.Activate(new Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), CLSCTX_ALL, IntPtr.Zero, out ep);
    if (hr != 0 || ep == null) throw new COMException("could not activate IAudioEndpointVolume", hr);
    return (IAudioEndpointVolume)ep;
  }
  public static float GetScalar() {
    float level;
    int hr = Endpoint().GetMasterVolumeLevelScalar(out level);
    if (hr != 0) throw new COMException("GetMasterVolumeLevelScalar failed", hr);
    return level;
  }
  public static void SetScalar(float level) {
    Guid ctx = Guid.Empty;
    int hr = Endpoint().SetMasterVolumeLevelScalar(level, ref ctx);
    if (hr != 0) throw new COMException("SetMasterVolumeLevelScalar failed", hr);
  }
}
// STA runner: the whole COM call (create + use, on the same thread) runs on
// a dedicated single-threaded-apartment thread. The COM objects never leave
// that thread, so no cross-apartment marshalling is involved.
public static class Sta {
  public static float Get() {
    float result = 0; Exception err = null;
    var t = new Thread(() => { try { result = Vol.GetScalar(); } catch (Exception ex) { err = ex; } });
    t.SetApartmentState(ApartmentState.STA);
    t.Start(); t.Join();
    if (err != null) throw err;
    return result;
  }
  public static void Set(float level) {
    Exception err = null;
    var t = new Thread(() => { try { Vol.SetScalar(level); } catch (Exception ex) { err = ex; } });
    t.SetApartmentState(ApartmentState.STA);
    t.Start(); t.Join();
    if (err != null) throw err;
  }
}
// v1.0.0 (item B): volume keys via plain user32 keybd_event - NO COM, no
// STA thread, no endpoint activation. The COM shim above fails on machines
// where the endpoint cannot be activated, and then the slider was a dead
// "Unavailable". The keys move the REAL system volume in 2% steps, so a
// failed COM set falls back to them instead of failing outright.
public static class Keys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Press(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
'@ -ErrorAction Stop
# v1.0.0 (item B): set the volume with the volume keys, from a known level
# (or from 0 when the level is unknown: 50 downs guarantee 0, then up to
# the target). Returns the level the keys actually reached (2% steps, so
# the nearest even value) - never a fake number.
function Set-VolumeByKeys([int]$Target, [int]$From) {
  $steps = 0
  if ($From -ge 0) {
    $steps = [math]::Round(($Target - $From) / 2)
  } else {
    for ($i = 0; $i -lt 50; $i++) { [Keys]::Press(0xAE); Start-Sleep -Milliseconds 5 }
    $steps = [math]::Round($Target / 2)
  }
  $vk = if ($steps -ge 0) { 0xAF } else { 0xAE } # VK_VOLUME_UP / VK_VOLUME_DOWN
  for ($i = 0; $i -lt [math]::Abs($steps); $i++) { [Keys]::Press($vk); Start-Sleep -Milliseconds 5 }
  $reached = if ($From -ge 0) { $From + $steps * 2 } else { $steps * 2 }
  return [math]::Max(0, [math]::Min(100, $reached))
}
try {
  if ($Cmd -eq 'get') {
    $level = $null
    try { $level = [math]::Round([Sta]::Get() * 100) }
    catch {
      # STA attempt failed - try the direct (MTA) call before giving up.
      $level = [math]::Round([Vol]::GetScalar() * 100)
    }
    "{`"level`": $level}"
  } elseif ($Cmd -eq 'set') {
    $clamped = [math]::Max(0, [math]::Min(100, $Level))
    $via = 'com'; $reached = $clamped
    try { [Sta]::Set($clamped / 100.0) }
    catch {
      try { [Vol]::SetScalar($clamped / 100.0) }
      catch {
        # COM shim failed entirely (the failure on PJ's machine): fall back
        # to the volume keys - a plain user32 call that moves the real
        # system volume. The level reported is the level the keys reached.
        $reached = Set-VolumeByKeys $clamped $From
        $via = 'keys'
      }
    }
    "{`"ok`":true,`"level`": $reached,`"via`":`"$via`"}"
  } else {
    Write-Error "unknown command: $Cmd (use get | set <0-100>)"; exit 1
  }
} catch {
  $msg = ($_.Exception.Message -replace '"', "'")
  if ($Cmd -eq 'get') { "{`"level`":null,`"error`":`"$msg`"}" }
  else { Write-Error $msg; exit 1 }
}
