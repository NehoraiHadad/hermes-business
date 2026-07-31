import { useEffect, useState } from 'react'
import { deriveCuratorNotifications, type CuratorNotification } from '../lib/hermes/curator'

// Loads Curator/learning insights from the desktop bridge and reshapes them into
// friendly notifications. Purely additive and best-effort: without a desktop
// bridge (browser/demo) or on any error it stays empty, so the UI never shows a
// fabricated "the agent learned…" message.
export function useCuratorInsights(enabled: boolean): CuratorNotification[] {
  const [notifications, setNotifications] = useState<CuratorNotification[]>([])

  useEffect(() => {
    if (!enabled || !window.hermesDesktop?.getCuratorInsights) {
      setNotifications([])
      return
    }
    let active = true
    window.hermesDesktop
      .getCuratorInsights()
      .then(insights => {
        if (active) setNotifications(deriveCuratorNotifications(insights))
      })
      .catch(() => {
        if (active) setNotifications([])
      })
    return () => {
      active = false
    }
  }, [enabled])

  return notifications
}
