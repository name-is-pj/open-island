# Windows notification mirroring via the WinRT UserNotificationListener.
# Usage: notifications.ps1 <list|request>
# - list: returns the current toasts as JSON {ok, items:[{app,title,text,time}]}
# - request: asks Windows for notification-listener access, returns {ok, access}
# HONEST LIMIT: the listener API needs the calling app to have a package
# identity (MSIX). An unpackaged portable Electron app gets AccessDenied, so
# on this app the call fails and the island shows that plainly instead of
# faking a list. The island still mirrors the app's own notifications.
param([string]$Cmd = 'list')
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop | Out-Null
  $listenerType = [Windows.UI.Notifications.UserNotificationListener, Windows.UI, ContentType=WindowsRuntime]
  if ($Cmd -eq 'request') {
    $status = $listenerType::Current.RequestAccessAsync().GetAwaiter().GetResult()
    '{"ok":true,"access":"' + $status + '"}'
    exit 0
  }
  $listener = $listenerType::Current
  $notifs = $listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast).GetAwaiter().GetResult()
  $items = @()
  foreach ($n in $notifs) {
    try {
      $xml = $n.Notification.Content.GetXml()
      $texts = @()
      foreach ($t in $xml.GetElementsByTagName('text')) { if ($t.InnerText) { $texts += $t.InnerText } }
      $items += [pscustomobject]@{
        app = $n.AppInfo.DisplayInfo.DisplayName
        title = if ($texts.Count -gt 0) { $texts[0] } else { '' }
        text = if ($texts.Count -gt 1) { ($texts[1..($texts.Count - 1)] -join ' ') } else { '' }
        time = $n.CreationTime.ToString('o')
      }
    } catch { }
  }
  [pscustomobject]@{ ok = $true; items = $items } | ConvertTo-Json -Compress -Depth 3
} catch { '{"ok":false,"error":"' + ($_.Exception.Message -replace '"', "'") + '"}' }
