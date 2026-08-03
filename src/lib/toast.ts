// A tiny toast model shared by the app shell and mini window. Deliberately NOT a
// stacked queue: only the latest toast is ever shown (replace-with-latest), which
// keeps the UI to the single `.floating-toast` surface that already exists in both
// shells. What it fixes over the old `useState('')` channel is the RACE: every
// toast gets its own id, and the timer that auto-clears it only does so if that
// same id is still the one on screen — so a slow-clearing toast A can never blank
// a toast B that replaced it, and an error toast lingers long enough to be read.
export type ToastSeverity = 'info' | 'error'

export type ToastMessage = {
  id: number
  message: string
  severity: ToastSeverity
}

// Errors linger long enough to actually read; routine confirmations clear fast.
export const TOAST_DURATIONS_MS: Record<ToastSeverity, number> = {
  info: 2500,
  error: 6000
}

let toastSequence = 0

// Exported for tests that need deterministic ids across runs.
export function resetToastSequence(): void {
  toastSequence = 0
}

export function createToast(message: string, severity: ToastSeverity = 'info'): ToastMessage {
  toastSequence += 1
  return { id: toastSequence, message, severity }
}

export type ToastAction = { type: 'show'; toast: ToastMessage } | { type: 'dismiss'; id: number }

// Pure reducer: 'show' always replaces whatever is on screen (the "keep it
// simple" queue policy). 'dismiss' only clears the CURRENT toast if the id
// matches — the guard that makes an in-flight timer from a stale toast a no-op
// once a newer toast has taken its place.
export function toastReducer(state: ToastMessage | null, action: ToastAction): ToastMessage | null {
  if (action.type === 'show') return action.toast
  if (state && state.id === action.id) return null
  return state
}
