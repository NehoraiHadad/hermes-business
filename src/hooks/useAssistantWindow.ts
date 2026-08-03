import { useCallback, useEffect, useState } from 'react'

// Bridges the Electron window controls (mini/full mode, always-on-top pin, hide)
// and keeps the renderer's copy of the window state in sync. Onboarding always
// forces the full window so the multi-step flow is usable.
//
// The DELIBERATE exception to "all renderer I/O goes through hermesClient": these
// calls move the app's OWN window. They carry no Hermes data, so there is nothing a
// demo fixture could faithfully stand in for — a browser tab simply has no window to
// resize or pin — and every call is already a correct no-op without a bridge (the
// local `windowState` stays 'full', which is exactly right for a browser). Routing
// them through a demo-swappable facade would add indirection and zero honesty. See
// the matching note in src/lib/hermes/desktop.ts.
export function useAssistantWindow(showOnboarding: boolean) {
  const [windowState, setWindowState] = useState<AssistantWindowState>({
    mode: 'full',
    alwaysOnTop: false,
    visible: true
  })

  useEffect(() => {
    if (!window.hermesDesktop) return
    void window.hermesDesktop.getWindowState().then(setWindowState)
  }, [])

  useEffect(() => {
    if (!showOnboarding || !window.hermesDesktop || windowState.mode !== 'mini') return
    void window.hermesDesktop.setWindowMode('full').then(setWindowState)
  }, [showOnboarding, windowState.mode])

  const enterMini = useCallback(async () => {
    if (window.hermesDesktop) setWindowState(await window.hermesDesktop.setWindowMode('mini'))
  }, [])

  const expandWindow = useCallback(async () => {
    if (window.hermesDesktop) setWindowState(await window.hermesDesktop.setWindowMode('full'))
  }, [])

  const togglePinned = useCallback(async () => {
    if (window.hermesDesktop) setWindowState(await window.hermesDesktop.setAlwaysOnTop(!windowState.alwaysOnTop))
  }, [windowState.alwaysOnTop])

  const hideWindow = useCallback(async () => {
    if (window.hermesDesktop) setWindowState(await window.hermesDesktop.hideWindow())
  }, [])

  return { windowState, enterMini, expandWindow, togglePinned, hideWindow }
}
