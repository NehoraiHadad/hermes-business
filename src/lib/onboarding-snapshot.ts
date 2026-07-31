import type { Connection, ScheduledTask, Skill } from '../types'

// Builds the bounded, wrapper-verified snapshot handed to the onboarding prompt.
// Kept pure and separate from App so the exact contract (what Hermes is told it
// already knows) is easy to read and unit-test.
export function buildVerifiedSnapshot(input: {
  runtime: HermesRuntime | null
  skills: Skill[]
  tasks: ScheduledTask[]
  connections: Connection[]
}): Record<string, unknown> {
  const { runtime, skills, tasks, connections } = input
  return {
    provider_ready: Boolean(runtime?.running),
    hermes_version: runtime?.version || null,
    skills: skills.map(skill => skill.name).slice(0, 100),
    scheduled_tasks: tasks.length,
    connections: connections.map(connection => ({
      id: connection.id,
      state: connection.state,
      official: connection.official !== false
    }))
  }
}
