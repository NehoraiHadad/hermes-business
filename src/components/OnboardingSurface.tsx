import type { ReactNode } from 'react'
import { buildOnboardingPrompt } from '../lib/onboarding-prompt'
import { buildVerifiedSnapshot } from '../lib/onboarding-snapshot'
import type { Connection, OnboardingData, ScheduledTask, Skill } from '../types'
import { Onboarding } from './onboarding/Onboarding'

export function OnboardingSurface({
  runtime,
  connections,
  skills,
  tasks,
  installing,
  installError,
  onInstall,
  onProvider,
  onConnection,
  beginConversation,
  onFinished,
  children
}: {
  runtime: HermesRuntime | null
  connections: Connection[]
  skills: Skill[]
  tasks: ScheduledTask[]
  installing: boolean
  installError: string
  onInstall: () => Promise<unknown>
  onProvider: () => void
  onConnection: (id: string) => void
  beginConversation: (input: { userMessage: string; submitText: string }) => Promise<void>
  onFinished: () => void
  children: ReactNode
}) {
  const complete = async (data: OnboardingData) => {
    const snapshot = buildVerifiedSnapshot({ runtime, skills, tasks, connections })
    await beginConversation({
      userMessage: 'סיימתי את ההיכרות הראשונית. שמור אותה ב־Hermes והמשך איתי לשאלה הבאה.',
      submitText: buildOnboardingPrompt(data, snapshot)
    })
    localStorage.setItem('hermes-business-onboarding-v1', 'complete')
    onFinished()
  }

  return (
    <>
      <Onboarding
        runtime={runtime}
        connections={connections}
        installing={installing}
        installError={installError}
        onInstall={onInstall}
        onProvider={onProvider}
        onConnection={onConnection}
        onComplete={complete}
      />
      {children}
    </>
  )
}
