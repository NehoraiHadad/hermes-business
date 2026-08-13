import type { GatewayEvent } from '../../types'

// Scripted demo conversations. Each starter suggestion in the chat empty state has
// its own scenario so the offline demo answers what was actually asked; anything
// else falls back to an honest "this is a demo" reply instead of pretending to work.
// Reachable ONLY through demo.ts (createDemoBackend → createDemoRpc), so the whole
// table is tree-shaken out of a non-demo build with the rest of the demo subtree.

export type DemoScenarioId = 'repeating-task' | 'client-reply' | 'week-plan' | 'fallback'

export type DemoScenario = {
  id: DemoScenarioId
  // OR of ANDs: the prompt matches when every keyword of at least one group is a
  // substring of the normalized text. Hebrew prefixes ride along (ללקוח ⊃ לקוח).
  match: string[][]
  tool?: { id: string; name: string; summary: string }
  chunks: string[]
  approval?: { command: string; reason: string; choices: string[] }
  followUp?: { approved: string[]; denied: string[] }
}

export type DemoScheduledEvent = { delay: number; event: GatewayEvent }

const MESSAGE_START_AT = 120
const TOOL_START_AT = 450
const TOOL_COMPLETE_AT = 1_250
const FIRST_CHUNK_WITH_TOOL_AT = 1_450
const FIRST_CHUNK_AT = 700
const CHUNK_STEP = 420
const APPROVAL_GAP = 540
const COMPLETE_AFTER_APPROVAL = 170
const COMPLETE_GAP = 380
const FOLLOW_UP_START_AT = 600
const FOLLOW_UP_FIRST_CHUNK_AT = 900

// Ordered most-specific signal first: a prompt about a task that repeats every week
// is about automation, not about the weekly plan; a prompt about answering a client
// before this week's meeting is about the reply, not the plan.
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'repeating-task',
    match: [['חוזר'], ['אוטומצ'], ['אוטומט'], ['שוב ושוב'], ['משימה קבועה']],
    tool: {
      id: 'tool-history',
      name: 'hermes.memory_search',
      summary: 'נסרקו השיחות מהחודש האחרון'
    },
    chunks: [
      'עברתי על מה שעשינו יחד בחודש האחרון. ',
      'יש דבר אחד שחוזר כמעט כל שבוע: אתה מבקש לבדוק אילו הצעות מחיר נשלחו ולא קיבלו תשובה, ואז מנסח הודעת המשך — בדיוק כמו במעקב אחרי ההצעה של דני. ',
      'בכל פעם זה לקח בערך חצי שעה. ',
      'אני מציע להפוך את זה למשימה קבועה: כל יום ראשון בבוקר אעבור על ההצעות שלא נענו חמישה ימים ואכין טיוטות מוכנות, ואתה רק תאשר. ',
      'אפשר להוסיף את זה במסך "פעילות ומשימות", ולשנות או לכבות בכל רגע.'
    ]
  },
  {
    id: 'client-reply',
    match: [['נסח'], ['לקוח'], ['ליד'], ['מייל'], ['הצעת מחיר'], ['תשובה', 'שלח']],
    tool: {
      id: 'tool-1',
      name: 'google_workspace.gmail_search',
      summary: 'נמצאו 18 לידים'
    },
    chunks: [
      'עברתי על הפניות החדשות. ',
      'מצאתי 18 לידים, ומתוכם 6 נראים דחופים במיוחד. ',
      'הייתי מתחיל היום עם דני, נועה וחברת אלומה — לכולם יש בקשה ברורה ותקציב מתאים. ',
      'הכנתי גם טיוטת מייל המשך לדני.'
    ],
    approval: {
      command: 'gmail send --to dani@example.com',
      reason: 'שליחת טיוטת המשך לדני בנושא הצעת המחיר',
      choices: ['once', 'session', 'deny']
    },
    followUp: {
      approved: [
        'שלחתי את המייל לדני. ',
        'אעדכן אותך ברגע שתגיע תשובה. ',
        'הטיוטות לנועה ולחברת אלומה מוכנות גם הן, ומחכות שתגיד לי לשלוח.'
      ],
      denied: [
        'לא שלחתי כלום. ',
        'הטיוטה שמורה, ואפשר לערוך אותה ולשלוח מתי שתרצה.'
      ]
    }
  },
  {
    id: 'week-plan',
    match: [['תכנן'], ['תכנון'], ['שבוע'], ['יומן'], ['פגיש'], ['לוח זמנים']],
    tool: {
      id: 'tool-calendar',
      name: 'google_calendar.list_events',
      summary: 'שלוש פגישות מחר, שבע השבוע'
    },
    chunks: [
      'עברתי על היומן שלך לשבוע הקרוב. ',
      'מחר יש שלוש פגישות, והכבדה שבהן היא זו של הצהריים — השארתי לך את הבוקר פנוי להתכונן אליה. ',
      'ביום רביעי כדאי לסגור את המעקב מול דני על הצעת המחיר, לפני שהוא יוצא לחופשה. ',
      'ליום חמישי אחר הצהריים שמרתי שעה לתוכנית התוכן לאוגוסט — נשארו ארבעה פרסומים לאשר. ',
      'רוצה שאסדר את זה כרשימת משימות לפי ימים?'
    ]
  }
]

export const DEMO_FALLBACK_SCENARIO: DemoScenario = {
  id: 'fallback',
  match: [],
  chunks: [
    'זו סביבת הדגמה, ואני עונה בה על דוגמאות שהוכנו מראש. ',
    'אפשר לנסות אחת משלוש ההתחלות: "נסח תשובה ללקוח", "עזור לי לתכנן את השבוע" או "מצא משימה שחוזרת על עצמה". ',
    'כשתחבר את העוזר האמיתי, אענה כאן על כל דבר שתבקש.'
  ]
}

export function normalizeDemoPrompt(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function matchDemoScenario(text: string): DemoScenario {
  const normalized = normalizeDemoPrompt(text)
  if (!normalized) return DEMO_FALLBACK_SCENARIO
  const matched = DEMO_SCENARIOS.find(scenario =>
    scenario.match.some(group => group.every(keyword => normalized.includes(normalizeDemoPrompt(keyword))))
  )
  return matched || DEMO_FALLBACK_SCENARIO
}

export function findDemoScenario(id: DemoScenarioId): DemoScenario | null {
  return DEMO_SCENARIOS.find(scenario => scenario.id === id) || null
}

export function isApprovalGranted(choice: string): boolean {
  return choice !== 'deny'
}

function streamedEvents(
  sessionId: string,
  chunks: string[],
  options: {
    openAt: number
    firstChunkAt: number
    tool?: DemoScenario['tool']
    approval?: DemoScenario['approval']
  }
): DemoScheduledEvent[] {
  const events: DemoScheduledEvent[] = [
    { delay: options.openAt, event: { type: 'message.start', session_id: sessionId, payload: {} } }
  ]
  if (options.tool) {
    const { id, name, summary } = options.tool
    events.push({
      delay: TOOL_START_AT,
      event: { type: 'tool.start', session_id: sessionId, payload: { tool_id: id, name } }
    })
    events.push({
      delay: TOOL_COMPLETE_AT,
      event: { type: 'tool.complete', session_id: sessionId, payload: { tool_id: id, name, summary } }
    })
  }
  chunks.forEach((text, index) => {
    events.push({
      delay: options.firstChunkAt + index * CHUNK_STEP,
      event: { type: 'message.delta', session_id: sessionId, payload: { text } }
    })
  })

  const lastChunkAt = options.firstChunkAt + Math.max(0, chunks.length - 1) * CHUNK_STEP
  if (options.approval) {
    events.push({
      delay: lastChunkAt + APPROVAL_GAP,
      event: { type: 'approval.request', session_id: sessionId, payload: { ...options.approval } }
    })
  }
  events.push({
    delay: options.approval ? lastChunkAt + APPROVAL_GAP + COMPLETE_AFTER_APPROVAL : lastChunkAt + COMPLETE_GAP,
    event: {
      type: 'message.complete',
      session_id: sessionId,
      payload: { text: chunks.join(''), status: 'complete' }
    }
  })
  return events
}

export function buildScenarioEvents(scenario: DemoScenario, sessionId: string): DemoScheduledEvent[] {
  return streamedEvents(sessionId, scenario.chunks, {
    openAt: MESSAGE_START_AT,
    firstChunkAt: scenario.tool ? FIRST_CHUNK_WITH_TOOL_AT : FIRST_CHUNK_AT,
    tool: scenario.tool,
    approval: scenario.approval
  })
}

// What the user actually approved has to happen (or visibly not happen) — the demo
// answers the approval instead of going silent at the moment trust is being asked for.
export function buildApprovalFollowUpEvents(
  scenario: DemoScenario,
  choice: string,
  sessionId: string
): DemoScheduledEvent[] {
  if (!scenario.followUp) return []
  const chunks = isApprovalGranted(choice) ? scenario.followUp.approved : scenario.followUp.denied
  if (!chunks.length) return []
  return streamedEvents(sessionId, chunks, {
    openAt: FOLLOW_UP_START_AT,
    firstChunkAt: FOLLOW_UP_FIRST_CHUNK_AT
  })
}
