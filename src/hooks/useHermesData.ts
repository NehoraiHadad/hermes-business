import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { CONNECTIONS } from '../constants'
import { hydrateConnectionStates } from '../lib/connections'
import { hermesClient } from '../lib/hermes-client'
import { resolveProviderStatus } from '../lib/provider-readiness'
import type { ProviderStatus } from '../lib/provider-readiness'
import { settleRuntimeBoot } from '../lib/runtime-boot'
import type { ScheduledTask, Session, Skill } from '../types'

// Owns discovery/install/boot plus the state shared with the full Hermes profile.
// `refresh` is reusable after installation so onboarding never needs a reload.
export function useHermesData() {
  const mounted = useRef(true)
  const [runtime, setRuntime] = useState<HermesRuntime | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [connections, setConnections] = useState(CONNECTIONS)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>(() =>
    resolveProviderStatus({ runtime: null })
  )
  const provider = { connected: providerStatus.provider_configured, label: providerStatus.provider_label }
  const [versions, setVersions] = useState<Record<string, string>>({})
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState('')
  // Whether the last authoritative LIST read failed, so the support panel can show
  // "could not read" instead of a false-healthy empty list. Reset each refresh.
  const [loadErrors, setLoadErrors] = useState<{ tasks: boolean; connections: boolean }>({ tasks: false, connections: false })

  // Per-slice fetchers (docs/specs/live-refresh.md §5.5, phase 3): each owns exactly
  // one server-state slice's data AND its own loadErrors flag, and each is safe to
  // call independently — not just from `refresh` below, but also as the fetcher a
  // server-state store slice invokes on invalidate()/reconnect/focus/backstop
  // (wired once in App.tsx via server-state-wiring.ts). Same calls, same fail-closed
  // loadErrors doctrine as before the split; only the composition changed.
  const fetchSessions = useCallback(async () => {
    const nextSessions = await hermesClient.listSessions().catch(() => [])
    if (!mounted.current) return
    startTransition(() => setSessions(nextSessions))
  }, [])

  const fetchSchedule = useCallback(async () => {
    let failed = false
    const nextTasks = await hermesClient.listTasks().catch(() => {
      failed = true
      return []
    })
    if (!mounted.current) return
    startTransition(() => {
      setTasks(nextTasks)
      setLoadErrors(prev => ({ ...prev, tasks: failed }))
    })
  }, [])

  const fetchConnections = useCallback(async () => {
    let failed = false
    const [messaging, googleStatus] = await Promise.all([
      hermesClient.listMessagingPlatforms().catch(() => {
        failed = true
        return []
      }),
      hermesClient.getGoogleStatus().catch(() => {
        failed = true
        return { available: false, authenticated: false }
      })
    ])
    if (!mounted.current) return
    startTransition(() => {
      setConnections(hydrateConnectionStates(CONNECTIONS, messaging, googleStatus.authenticated))
      setLoadErrors(prev => ({ ...prev, connections: failed }))
    })
  }, [])

  // Reusable for existing callers (boot/install/modals) as the full refreshAll: boots
  // the runtime, then runs every per-slice fetcher above IN PARALLEL alongside the two
  // reads that have no server-state slice of their own (skills, provider readiness),
  // exactly as the pre-split monolithic version did.
  const refresh = useCallback(async () => {
    const nextRuntime = await settleRuntimeBoot(() => hermesClient.boot())
    if (!mounted.current) return nextRuntime
    setRuntime(nextRuntime)
    setInstallError(nextRuntime.running ? '' : nextRuntime.error || '')
    if (!nextRuntime.running) {
      // Runtime down → we cannot inspect providers OR read any list; fail closed
      // (unknown provider, and the lists are unread, not empty-healthy). The demo
      // backend reports a RUNNING runtime, so it takes the normal path; a fixture
      // session that somehow failed to boot fails closed here too, as it should.
      setProviderStatus(resolveProviderStatus({ runtime: nextRuntime, error: nextRuntime.error }))
      setLoadErrors({ tasks: true, connections: true })
      return nextRuntime
    }

    const [, , nextSkills, , oauthProviders, env] = await Promise.all([
      fetchSessions(),
      fetchSchedule(),
      hermesClient.listSkills().catch(() => []),
      fetchConnections(),
      // Official provider sources: a FAILED inspection must stay null (→ unknown),
      // never []/{} — an empty success would be read as proof of "no provider".
      hermesClient.listOAuthProviders().catch(() => null),
      hermesClient
        .api<Record<string, { is_set?: boolean }>>('/api/env?profile=default')
        .catch(() => null)
    ])
    if (!mounted.current) return nextRuntime
    startTransition(() => {
      setSkills(nextSkills)
      setProviderStatus(resolveProviderStatus({ runtime: nextRuntime, oauthProviders, env }))
    })
    const nextVersions = await hermesClient.getVersions().catch(() => ({}))
    if (mounted.current) setVersions(nextVersions)
    return nextRuntime
  }, [fetchSessions, fetchSchedule, fetchConnections])

  useEffect(() => {
    mounted.current = true
    void refresh().catch(caught => {
      if (mounted.current) setInstallError(caught instanceof Error ? caught.message : 'Hermes לא הופעל')
    })
    return () => {
      mounted.current = false
    }
  }, [refresh])

  const ensureInstalled = useCallback(async () => {
    setInstalling(true)
    setInstallError('')
    try {
      const result = await hermesClient.installHermes()
      if (!result.ok || !result.installed) throw new Error(`התקנת Hermes נכשלה (קוד ${result.code ?? 'לא ידוע'})`)
      const nextRuntime = await refresh()
      if (!nextRuntime.running) throw new Error(nextRuntime.error || 'Hermes הותקן אך השירות עדיין אינו פועל')
      return nextRuntime
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'התקנת Hermes נכשלה'
      setInstallError(message)
      throw caught
    } finally {
      setInstalling(false)
    }
  }, [refresh])

  return {
    runtime,
    setRuntime,
    sessions,
    tasks,
    setTasks,
    skills,
    setSkills,
    connections,
    provider,
    providerStatus,
    setConnections,
    versions,
    installing,
    installError,
    loadErrors,
    ensureInstalled,
    refresh,
    // Per-slice fetchers, exposed so App.tsx can register them with the
    // server-state store (docs/specs/live-refresh.md §5.4) — the store then
    // drives them from gateway change-events/reconnect/focus/backstop, and
    // this hook keeps owning the resulting React state either way.
    fetchSessions,
    fetchSchedule,
    fetchConnections
  }
}
