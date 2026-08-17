import type { ReactNode } from 'react'
import { hermesClient } from '../lib/hermes-client'
import { buildOnboardingPrompt } from '../lib/onboarding-prompt'
import { WELCOME_COMMAND } from '../../shared/onboarding-bootstrap.js'
import { buildBusinessContext, persistBusinessContext, providerReadyForCompletion } from '../lib/business-context'
import { buildVerifiedSnapshot } from '../lib/onboarding-snapshot'
import type { ProviderStatus } from '../lib/provider-readiness'
import type { Connection, OnboardingData, ScheduledTask, Skill } from '../types'
import { Onboarding } from './onboarding/Onboarding'

export function OnboardingSurface({
  runtime,
  connections,
  skills,
  tasks,
  providerStatus,
  installing,
  installError,
  onInstall,
  onProvider,
  beginConversation,
  onFinished,
  children
}: {
  runtime: HermesRuntime | null
  connections: Connection[]
  skills: Skill[]
  tasks: ScheduledTask[]
  providerStatus: ProviderStatus
  installing: boolean
  installError: string
  onInstall: () => Promise<unknown>
  onProvider: () => void
  beginConversation: (input: { userMessage: string; skillName: string; instruction: string }) => Promise<void>
  // introStarted=false means the DURABLE setup completed but the guided intro chat did
  // not start — a distinct, retryable outcome, never a silent success.
  onFinished: (result: { introStarted: boolean }) => void
  children: ReactNode
}) {
  const complete = async (data: OnboardingData) => {
    const snapshot = buildVerifiedSnapshot({ runtime, skills, tasks, connections, providerStatus })
    // Fail closed: the product requires a working provider. Do not complete unless
    // authoritative state proves one is ready (usable), regardless of a configured key.
    if (!providerReadyForCompletion(snapshot)) {
      throw new Error('צריך ספק AI פעיל ומאומת לפני סיום ההיכרות. חבר/י ספק AI ונסה/י שוב.')
    }
    // Persist + verify the COMPLETE durable, ROUTABLE business-context skill (all
    // onboarding fields + authoritative provider/connection facts + checksum) BEFORE the
    // agent conversation starts, so we never claim the agent saved anything it did not.
    // Fail closed → this throws and onboarding stays open.
    const context = buildBusinessContext({ data, snapshot, completedAt: new Date().toISOString() })
    await persistBusinessContext(hermesClient, context)
    // Only now begin the guided chat. Its failure must NOT undo the durable, verified
    // completion — but it is NOT a success either: we report introStarted so the caller
    // can tell the user the intro did not start and let them retry.
    let introStarted = true
    try {
      await beginConversation({
        userMessage: 'פתחתי את תכל׳ס. עזור לי להתחיל במה שאני צריך עכשיו, בלי שאלון התקנה.',
        skillName: WELCOME_COMMAND,
        instruction: buildOnboardingPrompt(data, snapshot)
      })
    } catch {
      introStarted = false
    }
    // localStorage is a cache only — set AFTER the durable write is verified.
    localStorage.setItem('hermes-business-onboarding-v1', 'complete')
    onFinished({ introStarted })
  }

  return (
    <>
      <Onboarding
        runtime={runtime}
        providerStatus={providerStatus}
        installing={installing}
        installError={installError}
        onInstall={onInstall}
        onProvider={onProvider}
        onComplete={complete}
      />
      {children}
    </>
  )
}
