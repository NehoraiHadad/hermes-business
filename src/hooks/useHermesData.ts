import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { CONNECTIONS } from '../constants'
import { hydrateConnectionStates } from '../lib/connections'
import { hermesClient } from '../lib/hermes-client'
import { resolveProviderReadiness } from '../lib/provider-readiness'
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
  const [provider, setProvider] = useState({ connected: false, label: 'לא מחובר' })
  const [versions, setVersions] = useState<Record<string, string>>({})
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState('')

  const refresh = useCallback(async () => {
    const nextRuntime = await hermesClient.boot()
    if (!mounted.current) return nextRuntime
    setRuntime(nextRuntime)
    if (!nextRuntime.running && !hermesClient.demo) return nextRuntime

    const [nextSessions, nextTasks, nextSkills, messaging, googleStatus, oauthProviders, env] = await Promise.all([
      hermesClient.listSessions().catch(() => []),
      hermesClient.listTasks().catch(() => []),
      hermesClient.listSkills().catch(() => []),
      hermesClient.listMessagingPlatforms().catch(() => []),
      window.hermesDesktop
        ? window.hermesDesktop.getGoogleStatus().catch(() => ({ available: false, authenticated: false }))
        : Promise.resolve({ available: false, authenticated: false }),
      hermesClient.listOAuthProviders().catch(() => []),
      hermesClient
        .api<Record<string, { is_set?: boolean }>>('/api/env?profile=default')
        .catch(() => ({}))
    ])
    if (!mounted.current) return nextRuntime
    startTransition(() => {
      setSessions(nextSessions)
      setTasks(nextTasks)
      setSkills(nextSkills)
      setConnections(hydrateConnectionStates(CONNECTIONS, messaging, googleStatus.authenticated))
      setProvider(resolveProviderReadiness(oauthProviders, env))
    })
    const nextVersions = window.hermesDesktop
      ? await window.hermesDesktop.getVersions().catch(() => ({}))
      : { hermes: '0.19.0', shell: '0.1.0' }
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
      if (!window.hermesDesktop) return await refresh()
      const result = await window.hermesDesktop.installHermes()
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
    setConnections,
    versions,
    installing,
    installError,
    ensureInstalled,
    refresh
  }
}
