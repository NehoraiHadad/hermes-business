export type Screen = 'chat' | 'tasks' | 'skills' | 'connections' | 'support'

export type Session = {
  id: string
  title: string
  preview: string
  started_at: number
  message_count: number
  source: string
}

export type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
  time?: string
  streaming?: boolean
  attachment?: { name: string; size: string }
}

export type Activity = {
  id: string
  tool: string
  label: string
  status: 'running' | 'done'
  detail?: string
}

export type Approval = {
  id: string
  sessionId: string
  title: string
  description: string
  command?: string
  choices: string[]
}

export type ClarifyRequest = {
  requestId: string
  sessionId: string
  question: string
  choices: string[]
  multiSelect: boolean
}

export type ScheduledTask = {
  id: string
  name: string
  prompt: string
  schedule: string
  enabled: boolean
  deliver?: string
  last_run?: string | null
  next_run?: string | null
}

export type Skill = {
  name: string
  description?: string
  enabled: boolean
  provenance?: 'bundled' | 'hub' | 'agent'
  usage?: number
}

export type Connection = {
  id: string
  name: string
  description: string
  state: 'connected' | 'available' | 'attention'
  official?: boolean
  icon: 'google' | 'telegram' | 'whatsapp'
}

export type GatewayEvent = {
  type: string
  session_id?: string
  payload?: Record<string, unknown>
}

export type OnboardingData = {
  userName: string
  role: string
  language: string
  responseStyle: string
  workHours: string
  approvals: string[]
  timeSavers: string
  businessName: string
  industry: string
  offerings: string
  customers: string
  businessHours: string
  communicationStyle: string
  restrictions: string
  recurringProcesses: string
  systems: string
}
