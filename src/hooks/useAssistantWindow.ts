import { useCallback, useEffect, useState } from 'react'

// Bridges the Electron window controls (mini/full mode, always-on-top pin, hide)
// and keeps the renderer's copy of the window state in sync. Onboarding always
// forces the full window so the multi-step flow is usable.
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
