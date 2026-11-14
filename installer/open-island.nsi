; OpenIsland v1.0.0 - Windows Installer (built with native makensis on Linux, no Wine needed)
; Installs the portable Electron build, Start Menu + Desktop shortcuts, Add/Remove Programs entry.
; Compiled with absolute -D paths (this makensis build cannot do !if /FileExists):
;   makensis -DSRC_DIR=<abs path to app/release/win-unpacked> -DOUTDIR=<abs path to hidden_files> -DICON_PATH=<abs path to app/assets/icon.ico> installer/open-island.nsi
;
; NOTES (honest to v1.0.0):
; - The installer exe carries the neon Open Island icon (assets/icon.ico), and
;   so does the installed OpenIsland.exe (embedded with npm run icon:exe).
; - The app is UNSIGNED: Windows SmartScreen will warn on first run
;   ("More info" -> "Run anyway").
; - v5.0.1: the installer stops a running OpenIsland before copying files
;   (taskkill), and the uninstaller stops the app AND restores the Windows
;   taskbar + work area before deleting anything — v5.0.0's uninstaller did
;   neither, so the app kept running and the taskbar stayed hidden after
;   uninstall. There is no manual "close the app first" step any more.
; - User data (settings, clipboard history, shelf, reminders) lives in
;   %APPDATA%\openisland and is NEVER touched by install or uninstall.

!include "MUI2.nsh"

; ---------- Branding ----------
Name "OpenIsland"
OutFile "${OUTDIR}\OpenIsland-Setup-1.0.0.exe"
InstallDir "$PROGRAMFILES64\OpenIsland"
InstallDirRegKey HKLM "Software\OpenIsland" "InstallDir"
RequestExecutionLevel admin
SetCompressor lzma
Icon "${ICON_PATH}"
!define MUI_ICON "${ICON_PATH}"
!define MUI_UNICON "${ICON_PATH}"

; Version info shown in file properties
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "OpenIsland"
VIAddVersionKey "CompanyName" "OpenIsland"
VIAddVersionKey "FileVersion" "1.0.0"
VIAddVersionKey "ProductVersion" "1.0.0"
VIAddVersionKey "FileDescription" "OpenIsland Setup"

; ---------- Modern UI ----------
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\OpenIsland.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch OpenIsland"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ---------- Install ----------
; Installing over an existing OpenIsland install replaces the app files in place
; (upgrade). Settings and user data in %APPDATA%\openisland are outside $INSTDIR
; and are never written or removed here.
Section "OpenIsland" SecMain
  ; v5.0.1 (item 2): stop a running app FIRST — the installer cannot
  ; overwrite OpenIsland.exe while it is running. Killing is safe: settings
  ; persist on change and clipboard history is persisted. taskkill exits
  ; non-zero when nothing is running; the exit code is popped and ignored,
  ; so the install continues either way.
  nsExec::ExecToStack 'taskkill /F /IM OpenIsland.exe'
  Pop $0
  Pop $1
  Sleep 1500

  SetOutPath "$INSTDIR"
  File /r "${SRC_DIR}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Registry: install location + Add/Remove Programs
  WriteRegStr HKLM "Software\OpenIsland" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenIsland" "DisplayName" "OpenIsland"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenIsland" "DisplayVersion" "1.0.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenIsland" "Publisher" "OpenIsland"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenIsland" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenIsland" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenIsland" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenIsland" "NoRepair" 1

  ; Shortcuts: Start Menu + Desktop
  CreateDirectory "$SMPROGRAMS\OpenIsland"
  CreateShortcut "$SMPROGRAMS\OpenIsland\OpenIsland.lnk" "$INSTDIR\OpenIsland.exe" "" "$INSTDIR\OpenIsland.exe" 0
  CreateShortcut "$SMPROGRAMS\OpenIsland\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\OpenIsland.lnk" "$INSTDIR\OpenIsland.exe" "" "$INSTDIR\OpenIsland.exe" 0
SectionEnd

; ---------- Uninstall ----------
Section "Uninstall"
  ; v5.0.1 (item 1): stop the running app FIRST. taskkill /F bypasses the
  ; app's quit handlers, so the taskbar + work-area restore below is
  ; REQUIRED, not optional — without it the app keeps running and the
  ; Windows taskbar stays hidden after uninstall (v5.0.0 verdict).
  nsExec::ExecToStack 'taskkill /F /IM OpenIsland.exe'
  Pop $0
  Pop $1
  Sleep 1500

  ; Restore the Windows taskbar + work area BEFORE deleting anything, using
  ; the app's own helpers while they still exist under $INSTDIR.
  ; A failed restore must never fail the uninstall — the exit codes are
  ; popped and ignored, and the fallback below runs either way.
  IfFileExists "$INSTDIR\resources\app.asar.unpacked\src\helpers\win\taskbar.ps1" 0 +3
    nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\src\helpers\win\taskbar.ps1" show'
    Pop $0
    Pop $1
  IfFileExists "$INSTDIR\resources\app.asar.unpacked\src\helpers\win\workarea.ps1" 0 +3
    nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\src\helpers\win\workarea.ps1" restore'
    Pop $0
    Pop $1

  ; Fallback (runs in all paths): if the helper files are already gone, write
  ; a minimal restore script to $TEMP and run it — same effect as the
  ; inline one-liner (FindWindow Shell_TrayWnd + Shell_SecondaryTrayWnd,
  ; ShowWindow SW_SHOW), written out line by line so no nested quoting is
  ; needed. Showing an already-visible taskbar is a harmless no-op.
  FileOpen $9 "$TEMP\oi-restore-taskbar.ps1" w
  FileWrite $9 'Add-Type -TypeDefinition @"$\r$\n'
  FileWrite $9 'using System;$\r$\n'
  FileWrite $9 'using System.Runtime.InteropServices;$\r$\n'
  FileWrite $9 'public static class OiTaskbarRestore {$\r$\n'
  FileWrite $9 '  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w);$\r$\n'
  FileWrite $9 '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);$\r$\n'
  FileWrite $9 '}$\r$\n'
  FileWrite $9 '"@$\r$\n'
  FileWrite $9 '$$t = [OiTaskbarRestore]::FindWindow("Shell_TrayWnd", $$null)$\r$\n'
  FileWrite $9 'if ($$t -ne [IntPtr]::Zero) { [void][OiTaskbarRestore]::ShowWindow($$t, 5) }$\r$\n'
  FileWrite $9 '$$s = [OiTaskbarRestore]::FindWindow("Shell_SecondaryTrayWnd", $$null)$\r$\n'
  FileWrite $9 'if ($$s -ne [IntPtr]::Zero) { [void][OiTaskbarRestore]::ShowWindow($$s, 5) }$\r$\n'
  FileClose $9
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$TEMP\oi-restore-taskbar.ps1"'
  Pop $0
  Pop $1
  Delete "$TEMP\oi-restore-taskbar.ps1"

  ; Remove installed files only. User data in %APPDATA%\openisland
  ; (settings, clipboard history, shelf, reminders) is intentionally kept.
  RMDir /r "$INSTDIR"

  Delete "$SMPROGRAMS\OpenIsland\OpenIsland.lnk"
  Delete "$SMPROGRAMS\OpenIsland\Uninstall.lnk"
  RMDir "$SMPROGRAMS\OpenIsland"
  Delete "$DESKTOP\OpenIsland.lnk"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenIsland"
  DeleteRegKey HKLM "Software\OpenIsland"
SectionEnd
