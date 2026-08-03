import { useCallback, useEffect, useRef, useState } from 'react'
import { TOAST_DURATIONS_MS, createToast, toastReducer, type ToastMessage, type ToastSeverity } from '../lib/toast'

// The single toast channel for the app. `notify` keeps the historically-required
// `(message: string) => void` call shape working everywhere (severity is an
// optional second argument), so every existing hook/component that only ever
// passed a message string keeps compiling and behaving the same by default
// (info, ~2.5s). Callers that DO know a call failed can opt into `'error'`,
// which lingers (~6s) instead of racing an unrelated toast's timer closed.
export function useToasts() {
  const [toast, setToastState] = useState<ToastMessage | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    },
    []
  )

  const dismiss = useCallback(() => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    setToastState(current => (current ? toastReducer(current, { type: 'dismiss', id: current.id }) : current))
  }, [])

  const notify = useCallback((message: string, severity: ToastSeverity = 'info') => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    const next = createToast(message, severity)
    setToastState(toastReducer(null, { type: 'show', toast: next }))
    timerRef.current = window.setTimeout(() => {
      // Guarded by id inside toastReducer: if a newer toast already replaced
      // this one, this timer clearing it is a no-op instead of a race.
      setToastState(current => toastReducer(current, { type: 'dismiss', id: next.id }))
    }, TOAST_DURATIONS_MS[severity])
  }, [])

  return { toast, notify, dismiss }
}
