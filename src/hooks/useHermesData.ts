import { startTransition, useEffect, useState } from 'react'
import { CONNECTIONS } from '../constants'
import { hydrateConnectionStates } from '../lib/connections'
import { hermesClient } from '../lib/hermes-client'
import type { ScheduledTask, Session, Skill } from '../types'

// Boots the runtime and loads the shared Hermes state (sessions, tasks, skills,
// connections, versions) once. Everything here mirrors the official APIs and is
// exposed with setters so screens can optimistically reflect user actions.
export function useHermesData() {
  const [runtime, setRuntime] = useState<HermesRuntime | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [connections, setConnections] = useState(CONNECTIONS)
  const [versions, setVersions] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      const nextRuntime = await hermesClient.boot()
      if (cancelled) return
      setRuntime(nextRuntime)
      if (!nextRuntime.running && !hermesClient.demo) return
      const [nextSessions, nextTasks, nextSkills, messaging, googleStatus] = await Promise.all([
        hermesClient.listSessions().catch(() => []),
        hermesClient.listTasks().catch(() => []),
        hermesClient.listSkills().catch(() => []),
        hermesClient.listMessagingPlatforms().catch(() => []),
        window.hermesDesktop
          ? window.hermesDesktop.getGoogleStatus().catch(() => ({ available: false, authenticated: false }))
          : Promise.resolve({ available: false, authenticated: false })
      ])
      if (cancelled) return
      startTransition(() => {
        setSessions(nextSessions)
        setTasks(nextTasks)
        setSkills(nextSkills)
        setConnections(hydrateConnectionStates(CONNECTIONS, messaging, googleStatus.authenticated))
      })
      if (window.hermesDesktop) {
        const nextVersions = await window.hermesDesktop.getVersions().catch(() => ({}))
        if (!cancelled) setVersions(nextVersions)
      } else {
        setVersions({ hermes: '0.19.0', shell: '0.1.0' })
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  return {
    runtime,
    setRuntime,
    sessions,
    tasks,
    setTasks,
    skills,
    setSkills,
    connections,
    setConnections,
    versions
  }
}
