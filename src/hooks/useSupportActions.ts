import { useCallback, useState } from 'react'
import { hermesClient, type HermesUpdateStatus } from '../lib/hermes-client'
import { runHermesUpdate } from '../lib/update-flow'

type OpenFull = (surface: 'desktop' | 'dashboard' | 'logs' | 'settings') => void

// Support-and-diagnostics actions: health check, restart, logs, safe diagnostic
// bundle, and the two-stage update (check + apply). The apply path delegates to
// the tested runHermesUpdate flow.
export function useSupportActions({
  setRuntime,
  setToast,
  openFull
}: {
  setRuntime: (runtime: HermesRuntime) => void
  setToast: (toast: string) => void
  openFull: OpenFull
}) {
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<HermesUpdateStatus | null>(null)

  const onHealth = useCallback(async () => {
    setChecking(true)
    try {
      await hermesClient.healthCheck()
      setToast('בדיקת התקינות הושלמה — הכול פועל כרגיל')
    } catch {
      setToast('נמצאה בעיה. אפשר לפתוח Logs או ליצור חבילת אבחון.')
    } finally {
      setChecking(false)
    }
  }, [setToast])

  const onRestart = useCallback(async () => {
    if (window.hermesDesktop) setRuntime(await window.hermesDesktop.restartRuntime())
    setToast('Hermes הופעל מחדש')
  }, [setRuntime, setToast])

  const onLogs = useCallback(() => openFull('logs'), [openFull])

  const onDiagnostics = useCallback(async () => {
    if (window.hermesDesktop) {
      const result = await window.hermesDesktop.createDiagnostics()
      if (result.ok) setToast(`חבילת האבחון נשמרה: ${result.path}`)
    } else {
      setToast('חבילת אבחון בטוחה נוצרה בהצלחה (מצב הדגמה)')
    }
  }, [setToast])

  const onUpdateCheck = useCallback(async () => {
    setUpdating(true)
    try {
      const result = await hermesClient.checkUpdate(true)
      setUpdateStatus(result)
      setToast(
        result.update_available
          ? `נמצא עדכון Hermes${typeof result.behind === 'number' && result.behind > 0 ? ` (${result.behind} שינויים)` : ''}`
          : result.message || 'Hermes מעודכן'
      )
    } catch {
      setToast('לא ניתן לבדוק עדכונים כרגע. לא בוצע שינוי.')
    } finally {
      setUpdating(false)
    }
  }, [setToast])

  const onUpdateApply = useCallback(async () => {
    if (!window.confirm('לעדכן את Hermes כעת? Hermes ייצור גיבוי ויבצע בדיקת תקינות בסיום.')) return
    setUpdating(true)
    try {
      const checked = await runHermesUpdate(hermesClient)
      setUpdateStatus(checked)
      setToast('Hermes עודכן ובדיקת התקינות עברה בהצלחה')
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : 'העדכון נכשל; המידע של Hermes נשמר')
    } finally {
      setUpdating(false)
    }
  }, [setToast])

  return { checking, updating, updateStatus, onHealth, onRestart, onLogs, onDiagnostics, onUpdateCheck, onUpdateApply }
}
