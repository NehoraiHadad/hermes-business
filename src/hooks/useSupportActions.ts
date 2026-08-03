import { useCallback, useState } from 'react'
import { interpretHealthResponse, withTimeout } from '../lib/health'
import { hermesClient, type HermesUpdateStatus } from '../lib/hermes-client'
import type { ToastSeverity } from '../lib/toast'
import { runHermesUpdate } from '../lib/update-flow'

type OpenFull = (surface: 'desktop' | 'dashboard' | 'logs' | 'settings') => void

// How long a restart may take before we stop claiming the connection came back.
// Generous enough for a cold gateway start, short enough to stay a UI action.
const RESTART_RECONNECT_TIMEOUT_MS = 30_000

// Support-and-diagnostics actions: health check, restart, logs, safe diagnostic
// bundle, and the two-stage update (check + apply). The apply path delegates to
// the tested runHermesUpdate flow. Failure branches pass severity 'error' so the
// toast queue (see useToasts) lets them linger longer than a routine confirmation.
export function useSupportActions({
  setRuntime,
  setToast,
  openFull
}: {
  setRuntime: (runtime: HermesRuntime) => void
  setToast: (toast: string, severity?: ToastSeverity) => void
  openFull: OpenFull
}) {
  const [checking, setChecking] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<HermesUpdateStatus | null>(null)

  const onHealth = useCallback(async () => {
    setChecking(true)
    try {
      // Fail closed: only claim health when the AUTHORITATIVE /api/health (+status)
      // response positively confirms it. ok:false, malformed data, an unhealthy
      // component, or a timeout all resolve to a surfaced problem — never "healthy".
      const raw = await withTimeout(hermesClient.healthCheck(), 15_000)
      const verdict = interpretHealthResponse(raw)
      setToast(
        verdict.healthy
          ? 'בדיקת התקינות הושלמה — הכול פועל כרגיל'
          : `נמצאה בעיה: ${verdict.reason}. אפשר לפתוח Logs או ליצור חבילת אבחון.`,
        verdict.healthy ? 'info' : 'error'
      )
    } catch {
      setToast(
        'בדיקת התקינות לא הושלמה (תקלת תקשורת או פסק זמן) — לא ניתן לאשר תקינות. אפשר לפתוח Logs או ליצור חבילת אבחון.',
        'error'
      )
    } finally {
      setChecking(false)
    }
  }, [setToast])

  // A restart kills the dashboard socket, so the old code's immediate success
  // toast was a lie: chat stayed dead. Claim success only after the transport is
  // provably usable again (bounded wait), otherwise say so honestly.
  const onRestart = useCallback(async () => {
    setRestarting(true)
    try {
      const runtime = await hermesClient.restartRuntime()
      setRuntime(runtime)
      if (!runtime.running) {
        setToast(runtime.error || 'Hermes לא חזר לפעול לאחר ההפעלה מחדש. אפשר לפתוח Logs או ליצור חבילת אבחון.', 'error')
        return
      }
      const reconnected = await hermesClient.waitForConnection({
        // Empty means the bridge reported no endpoint — fall back to the URL the
        // transport already knows rather than waiting on nothing.
        wsUrl: runtime.wsUrl || undefined,
        timeoutMs: RESTART_RECONNECT_TIMEOUT_MS
      })
      setToast(
        reconnected
          ? 'Hermes הופעל מחדש והחיבור חזר'
          : 'Hermes הופעל מחדש אך החיבור לצ׳אט טרם חזר. נסה שוב בעוד רגע, או פתח Logs.',
        reconnected ? 'info' : 'error'
      )
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : 'ההפעלה מחדש של Hermes נכשלה', 'error')
    } finally {
      setRestarting(false)
    }
  }, [setRuntime, setToast])

  const onLogs = useCallback(() => openFull('logs'), [openFull])

  const onDiagnostics = useCallback(async () => {
    try {
      const result = await hermesClient.createDiagnostics()
      if (result.ok) setToast(`חבילת האבחון נשמרה: ${result.path}`)
      else if (!result.canceled) setToast('יצירת חבילת האבחון נכשלה', 'error')
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : 'יצירת חבילת האבחון נכשלה', 'error')
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
      setToast('לא ניתן לבדוק עדכונים כרגע. לא בוצע שינוי.', 'error')
    } finally {
      setUpdating(false)
    }
  }, [setToast])

  const onUpdateApply = useCallback(async () => {
    if (
      !window.confirm(
        'לעדכן את Hermes כעת? Hermes המלא ייסגר, ייווצר גיבוי מלא (ZIP) לפני העדכון, ותתבצע בדיקת תקינות בסיום.'
      )
    )
      return
    setUpdating(true)
    try {
      const checked = await runHermesUpdate(hermesClient)
      setUpdateStatus(checked)
      setToast(
        checked.backup_path
          ? `Hermes עודכן. גיבוי מלא נשמר: ${checked.backup_path}`
          : 'Hermes עודכן ובדיקת התקינות עברה בהצלחה'
      )
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : 'העדכון נכשל; המידע של Hermes נשמר', 'error')
    } finally {
      setUpdating(false)
    }
  }, [setToast])

  return {
    checking,
    restarting,
    updating,
    updateStatus,
    onHealth,
    onRestart,
    onLogs,
    onDiagnostics,
    onUpdateCheck,
    onUpdateApply
  }
}
