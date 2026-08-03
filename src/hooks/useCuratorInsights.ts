import { useEffect, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'
import { deriveCuratorNotifications, type CuratorNotification } from '../lib/hermes/curator'

// Loads Curator/learning insights through the Hermes facade and reshapes them into
// friendly notifications. Purely additive and best-effort: when the read fails (no
// desktop bridge, or Hermes could not answer) it stays empty, so the UI never shows
// a fabricated "the agent learned…" message.
export function useCuratorInsights(enabled: boolean): CuratorNotification[] {
  const [notifications, setNotifications] = useState<CuratorNotification[]>([])

  useEffect(() => {
    if (!enabled) {
      setNotifications([])
      return
    }
    let active = true
    hermesClient
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
