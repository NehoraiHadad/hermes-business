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

    // Track which authoritative list reads FAILED so we never render a failed read as
    // a healthy empty list. Each entry flips its flag in its own catch.
    const errs = { tasks: false, connections: false }
    const [nextSessions, nextTasks, nextSkills, messaging, googleStatus, oauthProviders, env] = await Promise.all([
      hermesClient.listSessions().catch(() => []),
      hermesClient.listTasks().catch(() => {
        errs.tasks = true
        return []
      }),
      hermesClient.listSkills().catch(() => []),
      hermesClient.listMessagingPlatforms().catch(() => {
        errs.connections = true
        return []
      }),
      hermesClient.getGoogleStatus().catch(() => {
        errs.connections = true
        return { available: false, authenticated: false }
      }),
      // Official provider sources: a FAILED inspection must stay null (→ unknown),
      // never []/{} — an empty success would be read as proof of "no provider".
      hermesClient.listOAuthProviders().catch(() => null),
      hermesClient
        .api<Record<string, { is_set?: boolean }>>('/api/env?profile=default')
        .catch(() => null)
    ])
    if (!mounted.current) return nextRuntime
    startTransition(() => {
      setSessions(nextSessions)
      setTasks(nextTasks)
      setSkills(nextSkills)
      setConnections(hydrateConnectionStates(CONNECTIONS, messaging, googleStatus.authenticated))
      setProviderStatus(resolveProviderStatus({ runtime: nextRuntime, oauthProviders, env }))
      setLoadErrors(errs)
    })
    const nextVersions = await hermesClient.getVersions().catch(() => ({}))
    if (mounted.current) setVersions(nextVersions)
    return nextRuntime
  }, [])

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
    refresh
  }
}
