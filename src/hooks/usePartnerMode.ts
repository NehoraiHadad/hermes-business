import { useCallback, useEffect, useRef, useState } from 'react'
import { applyPartner, chooseFolder, loadPartnerState } from '../lib/partner'

// Owns Business Partner state for the settings/support surface. Every mutation
// goes through the desktop bridge (or the demo fallback) and re-reads the true
// resulting state, so the UI never shows an optimistic value the runtime did not
// actually apply.
export function usePartnerMode() {
  const mounted = useRef(true)
  const [state, setState] = useState<PartnerState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await loadPartnerState()
      if (mounted.current) setState(next)
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'טעינת מצב Partner נכשלה')
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
    }
  }, [refresh])

  const apply = useCallback(async (patch: Partial<PartnerSettings>) => {
    setBusy(true)
    setError('')
    try {
      const next = await applyPartner(patch)
      if (mounted.current) setState(next)
      return next
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'החלת ההגדרות נכשלה')
      throw caught
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  const addRoot = useCallback(async () => {
    if (!state) return
    const path = await chooseFolder()
    if (!path || state.roots.some(root => root.path === path)) return
    await apply({ roots: [...state.roots, { path, access: 'ro' }] })
  }, [state, apply])

  const setRootAccess = useCallback(
    async (path: string, access: 'ro' | 'rw') => {
      if (!state) return
      await apply({ roots: state.roots.map(root => (root.path === path ? { ...root, access } : root)) })
    },
    [state, apply]
  )

  const removeRoot = useCallback(
    async (path: string) => {
      if (!state) return
      await apply({ roots: state.roots.filter(root => root.path !== path) })
    },
    [state, apply]
  )

  return { state, busy, error, apply, addRoot, setRootAccess, removeRoot, refresh }
}
