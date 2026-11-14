# Window management for the taskbar dock + Deck trackpad (user32, no injection).
# Usage: windows.ps1 <list|focus|minimize|restore|show-desktop|start-menu|move|click> [args]
#   list                -> JSON [{hwnd,title,process,exe}] visible top-level windows with titles
#   focus <hwnd>        -> bring that window to the front
#   minimize <hwnd>     -> SW_MINIMIZE (the dock's Mac-style minimise)
#   restore <hwnd>      -> SW_RESTORE
#   show-desktop        -> Shell.Application MinimizeAll
#   start-menu          -> open the Windows Start menu (Ctrl+Esc)
#   move <dx> <dy>      -> move the system cursor by a relative delta (Deck trackpad)
#   click               -> left click at the current cursor position (Deck tap)
param([string]$Cmd, [string]$Arg1, [string]$Arg2)
try {
  $src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class W {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  public struct POINT { public int X; public int Y; }
  public static List<object[]> List() {
    var outList = new List<object[]>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      string exe = "";
      string path = "";
      try {
        var proc = System.Diagnostics.Process.GetProcessById((int)pid);
        exe = proc.ProcessName;
        try { path = proc.MainModule.FileName; } catch {} // protected / 64-bit-cross processes
      } catch {}
      outList.Add(new object[] { h.ToInt64(), sb.ToString(), exe, path });
      return true;
    }, IntPtr.Zero);
    return outList;
  }
  // Per-window icon thumbnail: ExtractAssociatedIcon -> PNG base64 data URL,
  // or "" when unavailable (never a fake placeholder). Used by the dock for
  // pinned + running apps (main.js caches by exe - this is NOT called on
  // every dock poll, only for exes whose icon is not cached yet).
  public static string IconDataUrl(string path) {
    try {
      if (string.IsNullOrEmpty(path)) return "";
      using (var icon = System.Drawing.Icon.ExtractAssociatedIcon(path)) {
        if (icon == null) return "";
        using (var bmp = icon.ToBitmap()) {
          using (var ms = new System.IO.MemoryStream()) {
            bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
          }
        }
      }
    } catch { return ""; }
  }
}
'@
  Add-Type -TypeDefinition $src -ReferencedAssemblies 'System.Drawing' -ErrorAction Stop | Out-Null
  switch ($Cmd) {
    'list' {
      $items = @()
      foreach ($w in [W]::List()) {
        # exe = full path when readable (dock matches pinned apps by it),
        # falling back to the bare process name; process = bare name.
        $items += [pscustomobject]@{ hwnd = $w[0]; title = $w[1]; process = $w[2]; exe = if ($w[3]) { $w[3] } else { $w[2] } }
      }
      [pscustomobject]@{ ok = $true; windows = $items } | ConvertTo-Json -Compress -Depth 3
    }
    'icons' {
      # windows.ps1 icons <exe-or-path>... -> {"ok":true,"icons":[{exe,icon}]}
      # NB: the first two paths bind to $Arg1/$Arg2 (param block), the rest
      # land in $args - collect all three sources.
      $all = @()
      if ($Arg1) { $all += $Arg1 }
      if ($Arg2) { $all += $Arg2 }
      $all += $args
      $icons = @()
      foreach ($p in $all) {
        $icons += [pscustomobject]@{ exe = $p; icon = [W]::IconDataUrl($p) }
      }
      [pscustomobject]@{ ok = $true; icons = $icons } | ConvertTo-Json -Compress -Depth 3
    }
    'focus' { $h = [IntPtr]::new([long]$Arg1); [void][W]::SetForegroundWindow($h); '{"ok":true}' }
    'minimize' { $h = [IntPtr]::new([long]$Arg1); [void][W]::ShowWindow($h, 6); '{"ok":true}' }
    'restore' { $h = [IntPtr]::new([long]$Arg1); [void][W]::ShowWindow($h, 9); [void][W]::SetForegroundWindow($h); '{"ok":true}' }
    'show-desktop' { (New-Object -ComObject Shell.Application).MinimizeAll(); '{"ok":true}' }
    'start-menu' { (New-Object -ComObject WScript.Shell).SendKeys('^{ESC}'); '{"ok":true}' }
    'move' {
      $p = New-Object W+POINT
      [void][W]::GetCursorPos([ref]$p)
      [void][W]::SetCursorPos($p.X + [int]$Arg1, $p.Y + [int]$Arg2)
      '{"ok":true}'
    }
    'click' { [W]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); [W]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); '{"ok":true}' }
    default { '{"ok":false,"error":"unknown command"}' }
  }
} catch { '{"ok":false,"error":"' + ($_.Exception.Message -replace '"', "'") + '"}' }
