# Read the user's REAL pinned taskbar apps - no defaults, no fakes.
# Usage: pinned-apps.ps1 -> {"pinned":[{name,path,icon}]}
#   Sources: %APPDATA%\Microsoft\Internet Explorer\Quick Launch\User
#   Pinned\TaskBar\*.lnk, each resolved via WScript.Shell COM (TargetPath).
#   UWP pins (TargetPath empty) are matched best-effort against
#   shell:AppsFolder by display name; their path is the AppsFolder path.
#   icon = ExtractAssociatedIcon -> PNG base64 data URL, or "" when the icon
#   cannot be extracted (UWP apps, missing targets). Never throws: on any
#   failure it prints {"pinned":[]} so the dock shows an honest empty list.
try {
  $dir = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
  $src = @'
using System;
using System.IO;
public static class PI {
  public static string IconDataUrl(string path) {
    try {
      if (string.IsNullOrEmpty(path) || !File.Exists(path)) return "";
      using (var icon = System.Drawing.Icon.ExtractAssociatedIcon(path)) {
        if (icon == null) return "";
        using (var bmp = icon.ToBitmap()) {
          using (var ms = new MemoryStream()) {
            bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
          }
        }
      }
    } catch { return ""; }
  }
}
'@
  Add-Type -TypeDefinition $src -ReferencedAssemblies 'System.Drawing' -ErrorAction SilentlyContinue | Out-Null
  $list = @()
  if (Test-Path $dir) {
    $shell = New-Object -ComObject WScript.Shell -ErrorAction Stop
    # Best-effort AppsFolder index for UWP pins (display name -> AppsFolder path).
    $appsFolder = @{}
    try {
      $sa = New-Object -ComObject Shell.Application -ErrorAction Stop
      $ns = $sa.NameSpace('shell:AppsFolder')
      if ($ns) { foreach ($it in $ns.Items()) { if ($it.Name) { $appsFolder[$it.Name] = $it.Path } } }
    } catch { /* UWP matching unavailable - .lnk pins still work */ }
    foreach ($lnk in (Get-ChildItem -Path $dir -Filter '*.lnk' -ErrorAction SilentlyContinue | Sort-Object Name)) {
      try {
        $name = [System.IO.Path]::GetFileNameWithoutExtension($lnk.Name)
        $sc = $shell.CreateShortcut($lnk.FullName)
        $target = $sc.TargetPath
        if ([string]::IsNullOrWhiteSpace($target)) {
          # UWP pin: match by display name in AppsFolder, else keep name only.
          $target = if ($appsFolder.ContainsKey($name)) { $appsFolder[$name] } else { '' }
        }
        $icon = ''
        try { $icon = [PI]::IconDataUrl($target) } catch { $icon = '' }
        $list += [pscustomobject]@{ name = $name; path = $target; icon = $icon }
      } catch { continue }
    }
  }
  [pscustomobject]@{ pinned = @($list) } | ConvertTo-Json -Compress -Depth 4
} catch { '{"pinned":[]}' }
