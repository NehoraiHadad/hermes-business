import {
  Activity as ActivityIcon,
  ArrowLeft,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  Clock3,
  Cloud,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  HeartPulse,
  Inbox,
  Lightbulb,
  LoaderCircle,
  Maximize2,
  Menu,
  MessageCircle,
  MessageSquarePlus,
  Minimize2,
  MoreHorizontal,
  Paperclip,
  Pause,
  Pin,
  PinOff,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  TerminalSquare,
  WandSparkles,
  Wifi,
  WifiOff,
  X,
  Zap
} from 'lucide-react'
import {
  FormEvent,
  ReactNode,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import ReactMarkdown from 'react-markdown'
import { hermesClient, type HermesUpdateStatus } from './lib/hermes-client'
import { hydrateConnectionStates } from './lib/connections'
import { approvalCopy, humanizeTool, humanSchedule } from './lib/presentation'
import type {
  Activity,
  Approval,
  ChatMessage,
  ClarifyRequest,
  Connection,
  OnboardingData,
  ScheduledTask,
  Screen,
  Session,
  Skill
} from './types'

const NAV_ITEMS: Array<{ id: Screen; label: string; icon: typeof MessageCircle }> = [
  { id: 'chat', label: 'שיחות', icon: MessageCircle },
  { id: 'tasks', label: 'משימות מתוזמנות', icon: CalendarClock },
  { id: 'skills', label: 'מה העוזר יודע', icon: WandSparkles },
  { id: 'connections', label: 'חיבורים', icon: PlugZap },
  { id: 'support', label: 'תמיכה ותקינות', icon: CircleHelp }
]

const INITIAL_MESSAGES: ChatMessage[] = []

const CONNECTIONS: Connection[] = [
  {
    id: 'google',
    name: 'Google Workspace',
    description: 'מייל, יומן, Drive, מסמכים ו־Sheets',
    state: 'available',
    official: true,
    icon: 'google'
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'דבר עם העוזר גם מהטלפון',
    state: 'available',
    official: true,
    icon: 'telegram'
  },
  {
    id: 'whatsapp-cloud',
    name: 'WhatsApp Business',
    description: 'החיבור הרשמי של Meta לעסקים',
    state: 'available',
    official: true,
    icon: 'whatsapp'
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp אישי',
    description: 'חיבור מהיר דרך WhatsApp Web — לא רשמי',
    state: 'attention',
    official: false,
    icon: 'whatsapp'
  }
]

const EMPTY_ONBOARDING: OnboardingData = {
  userName: '',
  role: 'בעל/ת העסק',
  language: 'עברית',
  responseStyle: 'קצר, ברור ומעשי',
  workHours: '09:00–18:00',
  approvals: ['שליחת הודעות ומיילים', 'מחיקה או שינוי קבצים', 'התחייבות כספית'],
  timeSavers: '',
  businessName: '',
  industry: '',
  offerings: '',
  customers: '',
  businessHours: '',
  communicationStyle: 'מקצועי, חם ולא מתנשא',
  restrictions: '',
  recurringProcesses: '',
  systems: ''
}

function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? 'logo--small' : ''}`} aria-hidden="true">
      <span className="logo__wing logo__wing--a" />
      <span className="logo__wing logo__wing--b" />
      <span className="logo__core" />
    </div>
  )
}

function StatusPill({ runtime, demo }: { runtime: HermesRuntime | null; demo: boolean }) {
  const online = Boolean(runtime?.running)
  return (
    <div className={`status-pill ${online ? 'status-pill--online' : ''}`}>
      <span className="status-pill__dot" />
      {demo ? 'מצב הדגמה' : online ? 'העוזר זמין' : runtime?.starting ? 'העוזר מתכונן…' : 'העוזר לא זמין'}
    </div>
  )
}

const SessionRow = memo(function SessionRow({
  session,
  active,
  onSelect
}: {
  session: Session
  active: boolean
  onSelect: (session: Session) => void
}) {
  return (
    <button className={`session-row ${active ? 'session-row--active' : ''}`} onClick={() => onSelect(session)}>
      <span className="session-row__title">{session.title || 'שיחה ללא כותרת'}</span>
      <span className="session-row__preview">{session.preview || 'אין תצוגה מקדימה'}</span>
      <span className="session-row__meta">
        {session.source === 'telegram' ? 'Telegram · ' : ''}
        {session.id === 'weekly-leads' ? 'לפני 30 דקות' : 'לאחרונה'}
      </span>
    </button>
  )
})

function Sidebar({
  screen,
  setScreen,
  sessions,
  activeSession,
  onSelectSession,
  onNewSession,
  runtime,
  taskCount
}: {
  screen: Screen
  setScreen: (screen: Screen) => void
  sessions: Session[]
  activeSession: string
  onSelectSession: (session: Session) => void
  onNewSession: () => void
  runtime: HermesRuntime | null
  taskCount: number
}) {
  const [query, setQuery] = useState('')
  const visibleSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return sessions
    return sessions.filter(item => `${item.title} ${item.preview}`.toLowerCase().includes(normalized))
  }, [query, sessions])

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        <div>
          <strong>העוזר לעסק</strong>
          <span>פשוט, זמין ומסונכרן</span>
        </div>
      </div>

      <button className="new-chat-button" onClick={onNewSession}>
        <MessageSquarePlus size={19} />
        שיחה חדשה
      </button>

      <nav className="main-nav" aria-label="ניווט ראשי">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className={screen === item.id ? 'main-nav__item main-nav__item--active' : 'main-nav__item'}
              onClick={() => setScreen(item.id)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.id === 'tasks' && taskCount > 0 ? <span className="nav-count">{taskCount}</span> : null}
            </button>
          )
        })}
      </nav>

      <div className="sidebar__divider" />

      <div className="sessions-title">
        <span>שיחות אחרונות</span>
        <button aria-label="אפשרויות שיחות">
          <MoreHorizontal size={17} />
        </button>
      </div>
      <label className="sidebar-search">
        <Search size={15} />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="חיפוש בשיחות" />
      </label>
      <div className="session-list">
        {visibleSessions.map(session => (
          <SessionRow
            key={session.id}
            session={session}
            active={screen === 'chat' && activeSession === session.id}
            onSelect={onSelectSession}
          />
        ))}
      </div>

      <div className="sidebar__footer">
        <StatusPill runtime={runtime} demo={hermesClient.demo} />
        <button className="profile-button">
          <span className="avatar">ע</span>
          <span>
            <strong>החשבון העסקי שלך</strong>
            <small>מופעל באמצעות Hermes</small>
          </span>
          <ChevronDown size={16} />
        </button>
      </div>
    </aside>
  )
}

function Topbar({
  title,
  runtime,
  onOpenFull,
  onMini
}: {
  title: string
  runtime: HermesRuntime | null
  onOpenFull: (surface: 'desktop' | 'dashboard' | 'logs' | 'settings') => void
  onMini: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <header className="topbar">
      <div className="topbar__title">
        <h1>{title}</h1>
        {runtime?.running ? (
          <span className="sync-label">
            <Check size={13} /> הכול מסונכרן
          </span>
        ) : null}
      </div>
      <div className="topbar__actions">
        <button className="outline-button outline-button--small" onClick={onMini}>
          <Minimize2 size={15} />
          צ׳אט קטן
        </button>
        <button className="icon-button" aria-label="עזרה">
          <CircleHelp size={19} />
        </button>
        <div className="full-menu-wrap">
          <button className="outline-button" onClick={() => setOpen(value => !value)}>
            <ExternalLink size={16} />
            כלים מתקדמים
            <ChevronDown size={15} />
          </button>
          {open ? (
            <div className="dropdown-menu">
              <button onClick={() => onOpenFull('desktop')}>
                <Logo small />
                <span>
                  <strong>Hermes Desktop</strong>
                  <small>הממשק המלא</small>
                </span>
              </button>
              <button onClick={() => onOpenFull('dashboard')}>
                <ActivityIcon size={17} />
                <span>
                  <strong>Dashboard</strong>
                  <small>ניהול מתקדם</small>
                </span>
              </button>
              <button onClick={() => onOpenFull('logs')}>
                <TerminalSquare size={17} />
                <span>
                  <strong>Logs</strong>
                  <small>מידע טכני</small>
                </span>
              </button>
              <button onClick={() => onOpenFull('settings')}>
                <Settings2 size={17} />
                <span>
                  <strong>הגדרות מתקדמות</strong>
                  <small>Providers, tools ו־profiles</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function MiniHeader({
  runtime,
  pinned,
  onNewSession,
  onTogglePin,
  onExpand,
  onHide
}: {
  runtime: HermesRuntime | null
  pinned: boolean
  onNewSession: () => void
  onTogglePin: () => void
  onExpand: () => void
  onHide: () => void
}) {
  return (
    <header className="mini-header">
      <div className="mini-header__identity">
        <span className="mini-avatar">
          <MessageCircle size={17} />
        </span>
        <span>
          <strong>העוזר שלי</strong>
          <small className={runtime?.running ? 'mini-status mini-status--online' : 'mini-status'}>
            {runtime?.running ? 'מוכן לעזור' : runtime?.starting ? 'מתכונן…' : 'לא זמין כרגע'}
          </small>
        </span>
      </div>
      <div className="mini-header__actions">
        <button onClick={onNewSession} aria-label="שיחה חדשה" title="שיחה חדשה">
          <MessageSquarePlus size={17} />
        </button>
        <button
          className={pinned ? 'mini-action--active' : ''}
          onClick={onTogglePin}
          aria-label={pinned ? 'בטל הצמדה מעל חלונות' : 'הצמד מעל חלונות'}
          title={pinned ? 'מוצמד מעל חלונות' : 'הצמד מעל חלונות'}
        >
          {pinned ? <Pin size={16} /> : <PinOff size={16} />}
        </button>
        <button onClick={onExpand} aria-label="פתח חלון מלא" title="פתח חלון מלא">
          <Maximize2 size={16} />
        </button>
        <button onClick={onHide} aria-label="הסתר את העוזר" title="הסתר">
          <Minimize2 size={16} />
        </button>
      </div>
    </header>
  )
}

function ApprovalCard({
  approval,
  onRespond
}: {
  approval: Approval
  onRespond: (choice: 'once' | 'deny') => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="approval-card">
      <div className="approval-card__icon">
        <ShieldCheck size={20} />
      </div>
      <div className="approval-card__body">
        <strong>{approval.title}</strong>
        <p>{approval.description}</p>
        {expanded && approval.command ? <pre>{approval.command}</pre> : null}
        <div className="approval-card__actions">
          <button className="primary-button primary-button--small" onClick={() => onRespond('once')}>
            <Check size={15} /> אשר פעם אחת
          </button>
          <button className="ghost-button ghost-button--danger" onClick={() => onRespond('deny')}>
            דחה
          </button>
          {approval.command ? (
            <button className="link-button" onClick={() => setExpanded(value => !value)}>
              {expanded ? 'הסתר פרטים' : 'הצג פרטים'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ClarifyCard({
  request,
  onRespond
}: {
  request: ClarifyRequest
  onRespond: (answer: string) => void
}) {
  const [answer, setAnswer] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const toggle = (choice: string) => {
    setSelected(current =>
      current.includes(choice) ? current.filter(item => item !== choice) : [...current, choice]
    )
  }
  return (
    <div className="approval-card clarify-card">
      <div className="approval-card__icon">
        <CircleHelp size={20} />
      </div>
      <div className="approval-card__body">
        <strong>כדי להמשיך, העוזר צריך לדעת:</strong>
        <p>{request.question}</p>
        {request.choices.length ? (
          <div className="approval-card__actions">
            {request.choices.map(choice => (
              <button
                key={choice}
                className={
                  request.multiSelect && selected.includes(choice)
                    ? 'primary-button primary-button--small'
                    : 'outline-button outline-button--small'
                }
                onClick={() => (request.multiSelect ? toggle(choice) : onRespond(choice))}
              >
                {choice}
              </button>
            ))}
            {request.multiSelect ? (
              <button
                className="primary-button primary-button--small"
                disabled={!selected.length}
                onClick={() => onRespond(JSON.stringify(selected))}
              >
                המשך
              </button>
            ) : null}
          </div>
        ) : null}
        <form
          className="modal-form"
          onSubmit={event => {
            event.preventDefault()
            if (answer.trim()) onRespond(answer.trim())
          }}
        >
          <label>
            <span>{request.choices.length ? 'תשובה אחרת' : 'התשובה שלך'}</span>
            <input value={answer} onChange={event => setAnswer(event.target.value)} />
          </label>
          <button className="primary-button primary-button--small" disabled={!answer.trim()}>
            שלח תשובה
          </button>
        </form>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`message message--${message.role}`}>
      {message.role === 'assistant' ? (
        <div className="assistant-avatar">
          <Logo small />
        </div>
      ) : null}
      <div className="message__content">
        <div className="message__bubble">
          {message.attachment ? (
            <div className="message-attachment">
              <FileText size={18} />
              <span>
                <strong>{message.attachment.name}</strong>
                <small>{message.attachment.size}</small>
              </span>
            </div>
          ) : null}
          <ReactMarkdown>{message.text || (message.streaming ? ' ' : '')}</ReactMarkdown>
          {message.streaming ? <span className="typing-cursor" /> : null}
        </div>
        {message.time ? <time>{message.time}</time> : null}
      </div>
    </article>
  )
}

function ActivityStrip({ activities }: { activities: Activity[] }) {
  if (!activities.length) return null
  return (
    <div className="activity-strip">
      {activities.slice(-2).map(activity => (
        <div key={activity.id} className="activity-row">
          {activity.status === 'running' ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <CheckCircle2 size={15} />
          )}
          <span>{activity.label}</span>
          {activity.detail ? <small>{activity.detail}</small> : null}
        </div>
      ))}
    </div>
  )
}

function ChatScreen({
  messages,
  activities,
  approval,
  clarify,
  busy,
  onSend,
  onStop,
  onApproval,
  onClarify
}: {
  messages: ChatMessage[]
  activities: Activity[]
  approval: Approval | null
  clarify: ClarifyRequest | null
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
  onApproval: (choice: 'once' | 'deny') => void
  onClarify: (answer: string) => void
}) {
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, activities, approval, clarify])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    setText('')
    onSend(value)
  }

  return (
    <main className="chat-screen">
      <div className="chat-scroll">
        <div className="conversation">
          <div className="conversation-date">היום</div>
          {!messages.length && !busy ? (
            <div className="empty-conversation">
              <span>
                <Sparkles size={20} />
              </span>
              <strong>מה נעשה היום?</strong>
              <p>אפשר לשאול, לנסח הודעה, לסכם מידע או להתחיל משימה חדשה.</p>
            </div>
          ) : null}
          {messages.map(message => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <ActivityStrip activities={activities} />
          {approval ? <ApprovalCard approval={approval} onRespond={onApproval} /> : null}
          {clarify ? <ClarifyCard request={clarify} onRespond={onClarify} /> : null}
          <div ref={endRef} />
        </div>
      </div>
      <div className="composer-wrap">
        <form className="composer" onSubmit={submit}>
          <textarea
            rows={1}
            disabled={busy}
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) submit(event)
            }}
            placeholder="מה תרצה לעשות?"
            aria-label="הודעה לעוזר"
          />
          <div className="composer__bottom">
            <div>
              <button type="button" className="composer-icon" aria-label="צירוף קובץ">
                <Paperclip size={18} />
              </button>
              <button type="button" className="composer-icon" aria-label="פעולות נוספות">
                <Plus size={18} />
              </button>
            </div>
            {busy ? (
              <button type="button" className="send-button send-button--stop" onClick={onStop} aria-label="עצור תשובה">
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button type="submit" className="send-button" disabled={!text.trim()} aria-label="שלח">
                <Send size={17} />
              </button>
            )}
          </div>
        </form>
        <p className="composer-hint">
          התשובות עשויות לכלול טעויות. פעולות משמעותיות יוצגו לך לאישור לפני ביצוע.
        </p>
      </div>
    </main>
  )
}

function EmptyAction({
  icon,
  title,
  text,
  action,
  onClick
}: {
  icon: ReactNode
  title: string
  text: string
  action: string
  onClick: () => void
}) {
  return (
    <div className="empty-action">
      <div className="empty-action__icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="primary-button" onClick={onClick}>
        <Plus size={17} /> {action}
      </button>
    </div>
  )
}

function TasksScreen({
  tasks,
  onToggle,
  onAdd
}: {
  tasks: ScheduledTask[]
  onToggle: (task: ScheduledTask) => void
  onAdd: () => void
}) {
  const nextRun = tasks.find(task => task.enabled && task.next_run)?.next_run || '—'
  return (
    <main className="content-screen">
      <section className="page-heading">
        <div>
          <h2>משימות מתוזמנות</h2>
          <p>Hermes יבצע אותן בזמן שקבעת, גם אם החלון סגור.</p>
        </div>
        <button className="primary-button" onClick={onAdd}>
          <Plus size={17} /> משימה חדשה
        </button>
      </section>
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-card__icon stat-card__icon--green">
            <Play size={18} />
          </span>
          <strong>{tasks.filter(task => task.enabled).length}</strong>
          <small>משימות פעילות</small>
        </div>
        <div className="stat-card">
          <span className="stat-card__icon stat-card__icon--amber">
            <Clock3 size={18} />
          </span>
          <strong>{nextRun}</strong>
          <small>הריצה הבאה</small>
        </div>
        <div className="stat-card">
          <span className="stat-card__icon stat-card__icon--blue">
            <CheckCircle2 size={18} />
          </span>
          <strong>Hermes</strong>
          <small>מקור המשימות וההרצות</small>
        </div>
      </div>
      <section className="panel">
        <div className="panel__title">
          <h3>כל המשימות</h3>
          <span>{tasks.length} משימות</span>
        </div>
        <div className="task-list">
          {tasks.map(task => (
            <article className="task-row" key={task.id}>
              <span className={`task-row__state ${task.enabled ? 'task-row__state--active' : ''}`}>
                {task.enabled ? <Zap size={18} /> : <Pause size={18} />}
              </span>
              <div className="task-row__main">
                <strong>{task.name}</strong>
                <p>{task.prompt}</p>
                <div className="task-row__meta">
                  <span>
                    <CalendarClock size={14} /> {humanSchedule(task.schedule)}
                  </span>
                  <span>
                    <Inbox size={14} /> {task.deliver === 'telegram' ? 'נשלח ל־Telegram' : 'נשמר ב־Hermes'}
                  </span>
                </div>
              </div>
              <div className="task-row__right">
                <span className={`state-label ${task.enabled ? 'state-label--active' : ''}`}>
                  {task.enabled ? 'פעיל' : 'מושהה'}
                </span>
                <button className="outline-button outline-button--small" onClick={() => onToggle(task)}>
                  {task.enabled ? 'השהה' : 'הפעל'}
                </button>
                <button className="icon-button">
                  <MoreHorizontal size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

function SkillsScreen({ skills, onAdd }: { skills: Skill[]; onAdd: () => void }) {
  const learnedSkill = skills.find(skill => skill.provenance === 'agent')
  return (
    <main className="content-screen">
      <section className="page-heading">
        <div>
          <h2>מה העוזר יודע</h2>
          <p>Skills הם תהליכים ויכולות ש־Hermes יודע להפעיל ולשפר.</p>
        </div>
        <button className="primary-button" onClick={onAdd}>
          <Sparkles size={17} /> למד תהליך חדש
        </button>
      </section>
      {learnedSkill ? (
        <div className="learning-banner">
          <span className="learning-banner__icon">
            <Lightbulb size={20} />
          </span>
          <div>
            <strong>העוזר למד תהליך חדש: {learnedSkill.name}</strong>
            <p>{learnedSkill.description || 'ה־Skill זמין גם בממשק המלא של Hermes.'}</p>
          </div>
          <button className="outline-button outline-button--small">הצג</button>
        </div>
      ) : null}
      <div className="skills-grid">
        {skills.map(skill => (
          <article className="skill-card" key={skill.name}>
            <div className="skill-card__top">
              <span className={`skill-icon skill-icon--${skill.provenance || 'bundled'}`}>
                {skill.provenance === 'agent' ? <Sparkles size={20} /> : <WandSparkles size={20} />}
              </span>
              <span className="state-label state-label--active">פעיל</span>
            </div>
            <h3>{skill.name}</h3>
            <p>{skill.description || 'יכולת זמינה לעוזר דרך Hermes.'}</p>
            <div className="skill-card__footer">
              <span>
                {skill.provenance === 'agent' ? 'נלמד על ידי העוזר' : 'מובנה ב־Hermes'}
              </span>
              <span>{skill.usage || 0} שימושים</span>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}

function ServiceIcon({ type }: { type: Connection['icon'] }) {
  if (type === 'google') {
    return (
      <span className="service-icon service-icon--google" aria-hidden="true">
        G
      </span>
    )
  }
  if (type === 'telegram') {
    return (
      <span className="service-icon service-icon--telegram" aria-hidden="true">
        <Send size={22} />
      </span>
    )
  }
  return (
    <span className="service-icon service-icon--whatsapp" aria-hidden="true">
      <MessageCircle size={23} />
    </span>
  )
}

function ConnectionsScreen({
  connections,
  onConnect
}: {
  connections: Connection[]
  onConnect: (connection: Connection) => void
}) {
  return (
    <main className="content-screen">
      <section className="page-heading">
        <div>
          <h2>חיבורים</h2>
          <p>חבר את הכלים שכבר משמשים את העסק. Hermes מנהל את החיבור מתחת למכסה.</p>
        </div>
      </section>
      <section className="panel connections-panel">
        <div className="panel__title">
          <h3>שירותים לעסק</h3>
          <span>החיבורים נשמרים רק במחשב שלך</span>
        </div>
        <div className="connections-grid">
          {connections.map(connection => (
            <article className="connection-card" key={connection.id}>
              <ServiceIcon type={connection.icon} />
              <div className="connection-card__content">
                <div>
                  <h3>{connection.name}</h3>
                  {connection.official === false ? <span className="unofficial-tag">לא רשמי</span> : null}
                </div>
                <p>{connection.description}</p>
                {connection.id === 'whatsapp' ? (
                  <small className="risk-note">מבוסס Baileys ועלול להיחסם. מומלץ מספר ייעודי.</small>
                ) : null}
              </div>
              {connection.state === 'connected' ? (
                <button className="connected-button" onClick={() => onConnect(connection)}>
                  <CheckCircle2 size={16} /> מחובר
                </button>
              ) : (
                <button className="outline-button outline-button--small" onClick={() => onConnect(connection)}>
                  חבר <ChevronLeft size={15} />
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
      <div className="privacy-note">
        <ShieldCheck size={19} />
        <div>
          <strong>השליטה נשארת אצלך</strong>
          <p>כל חיבור משתמש במנגנון הרשמי של Hermes. ניתן לנתק אותו בכל רגע מהממשק המלא.</p>
        </div>
      </div>
    </main>
  )
}

function CheckRow({
  label,
  value,
  state = 'ok'
}: {
  label: string
  value: string
  state?: 'ok' | 'warning'
}) {
  return (
    <div className="check-row">
      <span className={`check-row__icon ${state === 'ok' ? 'check-row__icon--ok' : ''}`}>
        {state === 'ok' ? <Check size={14} /> : <ActivityIcon size={14} />}
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SupportScreen({
  runtime,
  versions,
  tasks,
  connections,
  onHealth,
  onRestart,
  onLogs,
  onDiagnostics,
  onUpdateCheck,
  onUpdateApply,
  updateStatus,
  updating,
  checking,
  toast
}: {
  runtime: HermesRuntime | null
  versions: Record<string, string>
  tasks: ScheduledTask[]
  connections: Connection[]
  onHealth: () => void
  onRestart: () => void
  onLogs: () => void
  onDiagnostics: () => void
  onUpdateCheck: () => void
  onUpdateApply: () => void
  updateStatus: HermesUpdateStatus | null
  updating: boolean
  checking: boolean
  toast: string
}) {
  return (
    <main className="content-screen">
      <section className="page-heading">
        <div>
          <h2>תמיכה ותקינות</h2>
          <p>תמונה ברורה של מצב המערכת, בלי מידע רגיש.</p>
        </div>
        <button className="primary-button" onClick={onHealth} disabled={checking}>
          {checking ? <LoaderCircle className="spin" size={17} /> : <HeartPulse size={17} />}
          בדיקת תקינות
        </button>
      </section>
      {toast ? (
        <div className="success-toast">
          <CheckCircle2 size={18} /> {toast}
        </div>
      ) : null}
      <div className="support-grid">
        <section className="panel health-panel">
          <div className="panel__title">
            <h3>מצב המערכת</h3>
            <span className={`state-label ${runtime?.running ? 'state-label--active' : ''}`}>
              {runtime?.running ? 'הכול תקין' : 'דורש בדיקה'}
            </span>
          </div>
          <CheckRow label="Hermes Runtime" value={runtime?.running ? 'פועל' : 'לא פועל'} state={runtime?.running ? 'ok' : 'warning'} />
          <CheckRow label="ספק AI" value="מנוהל ב־Hermes" />
          <CheckRow
            label="Google Workspace"
            value={connections.find(item => item.id === 'google')?.state === 'connected' ? 'מחובר' : 'לא מחובר'}
            state={connections.find(item => item.id === 'google')?.state === 'connected' ? 'ok' : 'warning'}
          />
          <CheckRow
            label="Telegram"
            value={connections.find(item => item.id === 'telegram')?.state === 'connected' ? 'מחובר' : 'לא מחובר'}
            state={connections.find(item => item.id === 'telegram')?.state === 'connected' ? 'ok' : 'warning'}
          />
          <CheckRow label="משימות מתוזמנות" value={`${tasks.filter(task => task.enabled).length} פעילות`} />
        </section>
        <section className="panel version-panel">
          <div className="panel__title">
            <h3>גרסאות ועדכונים</h3>
          </div>
          <div className="version-row">
            <span>Hermes Agent</span>
            <strong>{versions.hermes || runtime?.version || '0.19.0'}</strong>
            <span className="up-to-date">
              {updateStatus?.update_available ? 'יש עדכון' : updateStatus ? 'מעודכן' : 'לא נבדק'}
            </span>
          </div>
          <div className="version-row">
            <span>Hermes לעסק</span>
            <strong>{versions.shell || '0.1.0'}</strong>
            <span className="up-to-date">מעודכן</span>
          </div>
          <p className="version-note">
            עדכון Hermes משתמש ב־<code>hermes update</code>, כולל snapshot ובדיקת תקינות, ואינו מוחק Profile,
            שיחות, זיכרון או Skills.
          </p>
          {updateStatus?.message ? <p className="version-note">{updateStatus.message}</p> : null}
          <div className="modal__actions">
            <button className="outline-button outline-button--small" onClick={onUpdateCheck} disabled={updating}>
              {updating ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
              בדוק עדכון
            </button>
            {updateStatus?.update_available && updateStatus.can_apply ? (
              <button className="primary-button" onClick={onUpdateApply} disabled={updating}>
                <Download size={15} /> עדכן עכשיו
              </button>
            ) : null}
          </div>
        </section>
      </div>
      <section className="panel support-actions">
        <div className="panel__title">
          <h3>פעולות תמיכה</h3>
        </div>
        <div className="support-action-grid">
          <button onClick={onRestart}>
            <span>
              <RefreshCw size={20} />
            </span>
            <strong>הפעל מחדש את Hermes</strong>
            <small>אתחול בטוח של שירות הרקע</small>
            <ChevronLeft size={16} />
          </button>
          <button onClick={onLogs}>
            <span>
              <TerminalSquare size={20} />
            </span>
            <strong>פתח Logs</strong>
            <small>מידע טכני לפתרון תקלות</small>
            <ChevronLeft size={16} />
          </button>
          <button onClick={onDiagnostics}>
            <span>
              <FileArchive size={20} />
            </span>
            <strong>צור חבילת אבחון</strong>
            <small>קובץ בטוח לשליחה לתמיכה</small>
            <Download size={16} />
          </button>
        </div>
      </section>
      <div className="diagnostic-safety">
        <ShieldCheck size={20} />
        <p>
          חבילת האבחון <strong>אינה כוללת</strong> API keys, תוכן שיחות, תוכן מיילים, קבצי עסק או פרטי לקוחות.
        </p>
      </div>
    </main>
  )
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal__close icon-button" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="modal__heading">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {children}
      </section>
    </div>
  )
}

function TaskModal({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (task: Pick<ScheduledTask, 'name' | 'prompt' | 'schedule'>) => Promise<void>
}) {
  const [form, setForm] = useState({ name: '', prompt: '', days: 'weekdays', time: '08:00' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const [hour, minute] = form.time.split(':')
      const schedule = form.days === 'weekdays' ? `${minute} ${hour} * * 0-4` : `${minute} ${hour} * * *`
      await onCreate({ name: form.name, prompt: form.prompt, schedule })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Hermes לא הצליח ליצור את המשימה')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal title="משימה מתוזמנת חדשה" subtitle="פשוט אומרים מה לעשות ומתי — Hermes מנהל את התזמון." onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>שם המשימה</span>
          <input
            required
            value={form.name}
            onChange={event => setForm({ ...form, name: event.target.value })}
            placeholder="למשל: סיכום בוקר"
          />
        </label>
        <label>
          <span>מה העוזר יעשה?</span>
          <textarea
            required
            rows={4}
            value={form.prompt}
            onChange={event => setForm({ ...form, prompt: event.target.value })}
            placeholder="סכם את הפגישות, המיילים החשובים והמשימות להיום"
          />
        </label>
        <div className="form-row">
          <label>
            <span>ימים</span>
            <select value={form.days} onChange={event => setForm({ ...form, days: event.target.value })}>
              <option value="weekdays">ימים א׳–ה׳</option>
              <option value="daily">כל יום</option>
            </select>
          </label>
          <label>
            <span>שעה</span>
            <input type="time" value={form.time} onChange={event => setForm({ ...form, time: event.target.value })} />
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            ביטול
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <CalendarClock size={16} />}
            צור משימה
          </button>
        </div>
      </form>
    </Modal>
  )
}

function SkillModal({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (name: string, description: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal title="למד את העוזר תהליך חדש" subtitle="Hermes ישמור את התהליך כ־Skill באותו Profile." onClose={onClose}>
      <form
        className="modal-form"
        onSubmit={async event => {
          event.preventDefault()
          setSaving(true)
          setError('')
          try {
            await onCreate(name.trim().toLowerCase().replace(/\s+/g, '-'), description)
            onClose()
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Hermes לא הצליח לשמור את ה־Skill')
          } finally {
            setSaving(false)
          }
        }}
      >
        <label>
          <span>שם קצר לתהליך</span>
          <input required value={name} onChange={event => setName(event.target.value)} placeholder="סיכום לידים שבועי" />
        </label>
        <label>
          <span>איך התהליך עובד?</span>
          <textarea
            required
            rows={6}
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="אסוף את הלידים החדשים, חלק לפי דחיפות, וציין למי כדאי לחזור קודם…"
          />
        </label>
        <div className="info-inline">
          <Sparkles size={17} />
          <span>העוזר יוכל לשפר את ה־Skill בהמשך לפי המשוב שלך.</span>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            ביטול
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} שמור Skill
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ProviderModal({
  onClose,
  onConnect
}: {
  onClose: () => void
  onConnect: (provider: string, key: string) => Promise<void>
}) {
  const [provider, setProvider] = useState('openrouter')
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal title="חיבור לספק AI" subtitle="המפתח נשמר ב־Hermes בלבד, לא במעטפת." onClose={onClose}>
      <form
        className="modal-form"
        onSubmit={async event => {
          event.preventDefault()
          setSaving(true)
          setError('')
          try {
            await onConnect(provider, key)
            onClose()
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'החיבור נכשל')
          } finally {
            setSaving(false)
          }
        }}
      >
        <label>
          <span>ספק</span>
          <select value={provider} onChange={event => setProvider(event.target.value)}>
            <option value="openrouter">OpenRouter</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
          </select>
        </label>
        <label>
          <span>API key</span>
          <input
            required
            type="password"
            autoComplete="off"
            value={key}
            onChange={event => setKey(event.target.value)}
            placeholder="הדבק כאן את המפתח"
            dir="ltr"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="info-inline">
          <ShieldCheck size={17} />
          <span>המפתח נבדק מול הספק ונשמר ב־.env של ה־Profile דרך ה־API הרשמי של Hermes.</span>
        </div>
        <div className="modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            ביטול
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <PlugZap size={16} />} חבר
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ConnectionModal({
  connection,
  onClose,
  onConnected
}: {
  connection: Connection
  onClose: () => void
  onConnected: (id: string) => void
}) {
  const [step, setStep] = useState(1)
  const [token, setToken] = useState('')
  const [userId, setUserId] = useState('')
  const [googleFile, setGoogleFile] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const connectTelegram = async () => {
    setSaving(true)
    setError('')
    try {
      await hermesClient.connectTelegram(token, userId)
      onConnected(connection.id)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'החיבור נכשל')
    } finally {
      setSaving(false)
    }
  }

  const startGoogle = async () => {
    if (hermesClient.demo) {
      setStep(2)
      return
    }
    if (!googleFile) return
    setSaving(true)
    setError('')
    try {
      await window.hermesDesktop!.startGoogleSetup(googleFile, 'all')
      setStep(2)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'לא ניתן להתחיל את החיבור')
    } finally {
      setSaving(false)
    }
  }

  const finishGoogle = async () => {
    setSaving(true)
    setError('')
    try {
      if (!hermesClient.demo) await window.hermesDesktop!.finishGoogleSetup(redirectUrl)
      onConnected(connection.id)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'האישור לא הושלם')
    } finally {
      setSaving(false)
    }
  }

  if (connection.id === 'telegram') {
    return (
      <Modal title="חיבור Telegram" subtitle="Hermes ישתמש ב־Gateway המובנה — אין צורך ב־MCP." onClose={onClose}>
        <div className="setup-steps">
          <div className="setup-instruction">
            <span>1</span>
            <p>
              פתח את <strong>@BotFather</strong> ב־Telegram ושלח <code>/newbot</code>.
            </p>
          </div>
          <div className="setup-instruction">
            <span>2</span>
            <p>הדבק כאן את ה־token שקיבלת ואת מזהה המשתמש שלך.</p>
          </div>
        </div>
        <div className="modal-form">
          <label>
            <span>Bot token</span>
            <input type="password" dir="ltr" value={token} onChange={event => setToken(event.target.value)} />
          </label>
          <label>
            <span>Telegram user ID</span>
            <input dir="ltr" value={userId} onChange={event => setUserId(event.target.value)} placeholder="123456789" />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="modal__actions">
            <button className="ghost-button" onClick={onClose}>
              ביטול
            </button>
            <button className="primary-button" disabled={!token || !userId || saving} onClick={connectTelegram}>
              {saving ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} חבר Telegram
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (connection.id === 'google') {
    return (
      <Modal title="חיבור Google Workspace" subtitle="OAuth מנוהל על ידי ה־google-workspace Skill הרשמי של Hermes." onClose={onClose}>
        {step === 1 ? (
          <div className="modal-form">
            <div className="oauth-summary">
              <ServiceIcon type="google" />
              <div>
                <strong>הרשאות מבוקשות</strong>
                <p>Gmail, Calendar, Drive, Docs ו־Sheets. ניתן לבחור סט מצומצם בממשק המלא.</p>
              </div>
            </div>
            <label>
              <span>קובץ OAuth Desktop app מ־Google Cloud</span>
              <button
                type="button"
                className="file-picker"
                onClick={async () => {
                  if (hermesClient.demo) setGoogleFile('client_secret_demo.json')
                  else {
                    const file = await window.hermesDesktop!.chooseFile([{ name: 'Google OAuth JSON', extensions: ['json'] }])
                    if (file) setGoogleFile(file)
                  }
                }}
              >
                <FileText size={18} />
                {googleFile ? googleFile.split(/[\\/]/).pop() : 'בחר קובץ JSON'}
              </button>
            </label>
            <button
              type="button"
              className="link-button link-button--external"
              onClick={() =>
                window.hermesDesktop?.openExternal('https://console.cloud.google.com/apis/credentials')
              }
            >
              איך יוצרים קובץ כזה? <ExternalLink size={14} />
            </button>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="modal__actions">
              <button className="ghost-button" onClick={onClose}>
                ביטול
              </button>
              <button className="primary-button" disabled={!googleFile || saving} onClick={startGoogle}>
                {saving ? <LoaderCircle className="spin" size={16} /> : <ArrowLeft size={16} />} המשך לאישור Google
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-form">
            <div className="oauth-summary oauth-summary--success">
              <Cloud size={24} />
              <div>
                <strong>חלון Google נפתח בדפדפן</strong>
                <p>לאחר האישור הדפדפן עשוי להציג שגיאה ב־localhost:1 — זה צפוי.</p>
              </div>
            </div>
            <label>
              <span>הדבק את כתובת ההפניה המלאה מסרגל הכתובות</span>
              <textarea
                dir="ltr"
                rows={4}
                value={redirectUrl}
                onChange={event => setRedirectUrl(event.target.value)}
                placeholder="http://localhost:1/?code=..."
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="modal__actions">
              <button className="ghost-button" onClick={() => setStep(1)}>
                חזרה
              </button>
              <button className="primary-button" disabled={!redirectUrl || saving} onClick={finishGoogle}>
                {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} סיים חיבור
              </button>
            </div>
          </div>
        )}
      </Modal>
    )
  }

  return (
    <Modal title={`חיבור ${connection.name}`} subtitle={connection.description} onClose={onClose}>
      <div className="whatsapp-choice">
        <ServiceIcon type="whatsapp" />
        <h3>{connection.official ? 'המסלול הרשמי לעסק' : 'חיבור WhatsApp Web לא רשמי'}</h3>
        <p>
          {connection.official
            ? 'דורש Meta Business, מספר עסקי וכתובת webhook ציבורית. יציב וללא סיכון חסימת חשבון.'
            : 'מבוסס Baileys ומדמה WhatsApp Web. מהיר להגדרה, אך עלול להישבר או להוביל להגבלת החשבון.'}
        </p>
        {!connection.official ? (
          <div className="warning-box">
            <ShieldCheck size={18} />
            מומלץ להשתמש במספר ייעודי ולא לשלוח הודעות המוניות.
          </div>
        ) : null}
        <button
          className="primary-button"
          onClick={() => {
            onConnected(connection.id)
            onClose()
          }}
        >
          פתח הגדרה מודרכת ב־Hermes <ExternalLink size={16} />
        </button>
      </div>
    </Modal>
  )
}

function Onboarding({
  runtime,
  onComplete,
  onProvider
}: {
  runtime: HermesRuntime | null
  onComplete: (data: OnboardingData) => Promise<void>
  onProvider: () => void
}) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState(EMPTY_ONBOARDING)
  const [saving, setSaving] = useState(false)
  const total = 5
  const patch = (values: Partial<OnboardingData>) => setData(current => ({ ...current, ...values }))
  return (
    <div className="onboarding">
      <section className="onboarding__card">
        <div className="onboarding__brand">
          <Logo />
          <strong>העוזר לעסק</strong>
        </div>
        <div className="onboarding__progress">
          {Array.from({ length: total }, (_, index) => (
            <span key={index} className={index + 1 <= step ? 'active' : ''} />
          ))}
          <small>
            שלב {step} מתוך {total}
          </small>
        </div>

        {step === 1 ? (
          <div className="onboarding__content onboarding__welcome">
            <div className="onboarding-hero">
              <Logo />
              <span className="onboarding-hero__spark">✦</span>
            </div>
            <h1>העסק שלך, עם Hermes מוכן לעבודה</h1>
            <p>נכיר אותך ואת העסק, נחבר את הכלים החשובים, ותוכל להתחיל בלי Terminal או קבצי הגדרות.</p>
            <div className="runtime-detection">
              {runtime?.installed ? <CheckCircle2 size={20} /> : <LoaderCircle className="spin" size={20} />}
              <div>
                <strong>{runtime?.installed ? 'Hermes זוהה במחשב' : 'בודק אם Hermes מותקן…'}</strong>
                <small>{runtime?.version || 'אותו Profile ישמש גם בממשק המלא'}</small>
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="onboarding__content">
            <span className="eyebrow">חיבור AI</span>
            <h1>מי יפעיל את העוזר?</h1>
            <p>Hermes תומך בכמה ספקים. אפשר להחליף גם בהמשך בלי לאבד שיחות או זיכרון.</p>
            <button className="provider-choice" onClick={onProvider}>
              <span className="provider-choice__icon">
                <Cloud size={21} />
              </span>
              <span>
                <strong>חבר ספק AI</strong>
                <small>OpenRouter, Anthropic, OpenAI או Gemini</small>
              </span>
              <ChevronLeft size={18} />
            </button>
            <div className="info-inline">
              <ShieldCheck size={17} />
              <span>המפתח נשמר ישירות ב־Hermes במחשב שלך.</span>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="onboarding__content">
            <span className="eyebrow">קצת עליך</span>
            <h1>איך תרצה לעבוד יחד?</h1>
            <div className="onboarding-form">
              <div className="form-row">
                <label>
                  <span>השם שלך</span>
                  <input value={data.userName} onChange={event => patch({ userName: event.target.value })} />
                </label>
                <label>
                  <span>התפקיד שלך</span>
                  <input value={data.role} onChange={event => patch({ role: event.target.value })} />
                </label>
              </div>
              <div className="form-row">
                <label>
                  <span>שפה מועדפת</span>
                  <select value={data.language} onChange={event => patch({ language: event.target.value })}>
                    <option>עברית</option>
                    <option>English</option>
                    <option>עברית ואנגלית</option>
                  </select>
                </label>
                <label>
                  <span>סגנון תשובות</span>
                  <select value={data.responseStyle} onChange={event => patch({ responseStyle: event.target.value })}>
                    <option>קצר, ברור ומעשי</option>
                    <option>מפורט עם הסברים</option>
                    <option>ישיר ותמציתי מאוד</option>
                  </select>
                </label>
              </div>
              <label>
                <span>מה הכי היית רוצה לחסוך?</span>
                <textarea
                  rows={3}
                  value={data.timeSavers}
                  onChange={event => patch({ timeSavers: event.target.value })}
                  placeholder="למשל: מעקב אחרי לידים, סיכומי בוקר ומענה ראשוני ללקוחות"
                />
              </label>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="onboarding__content">
            <span className="eyebrow">העסק שלך</span>
            <h1>מה חשוב ש־Hermes יכיר?</h1>
            <div className="onboarding-form">
              <div className="form-row">
                <label>
                  <span>שם העסק</span>
                  <input value={data.businessName} onChange={event => patch({ businessName: event.target.value })} />
                </label>
                <label>
                  <span>תחום הפעילות</span>
                  <input value={data.industry} onChange={event => patch({ industry: event.target.value })} />
                </label>
              </div>
              <label>
                <span>שירותים ומוצרים</span>
                <textarea rows={2} value={data.offerings} onChange={event => patch({ offerings: event.target.value })} />
              </label>
              <label>
                <span>מה אסור לעוזר להבטיח או להתחייב?</span>
                <textarea
                  rows={2}
                  value={data.restrictions}
                  onChange={event => patch({ restrictions: event.target.value })}
                  placeholder="למשל: מחיר סופי, מועד אספקה או החזר ללא אישור שלי"
                />
              </label>
              <label>
                <span>תהליכים שחוזרים על עצמם</span>
                <textarea
                  rows={2}
                  value={data.recurringProcesses}
                  onChange={event => patch({ recurringProcesses: event.target.value })}
                />
              </label>
            </div>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="onboarding__content">
            <span className="eyebrow">כמעט סיימנו</span>
            <h1>איפה העסק עובד היום?</h1>
            <p>אפשר לדלג ולחבר שירותים אחר כך.</p>
            <div className="onboarding-services">
              <button>
                <ServiceIcon type="google" />
                <span>
                  <strong>Google Workspace</strong>
                  <small>מייל, יומן ומסמכים</small>
                </span>
                <Plus size={17} />
              </button>
              <button>
                <ServiceIcon type="telegram" />
                <span>
                  <strong>Telegram</strong>
                  <small>העוזר גם בטלפון</small>
                </span>
                <Plus size={17} />
              </button>
            </div>
            <div className="onboarding-ready">
              <Sparkles size={19} />
              <span>
                המידע יישמר ב־<strong>USER.md</strong> וב־<strong>business-context Skill</strong> של אותו Profile.
              </span>
            </div>
          </div>
        ) : null}

        <div className="onboarding__footer">
          {step > 1 ? (
            <button className="ghost-button" onClick={() => setStep(value => value - 1)}>
              חזרה
            </button>
          ) : (
            <span />
          )}
          {step < total ? (
            <button className="primary-button" onClick={() => setStep(value => value + 1)}>
              המשך <ArrowLeft size={16} />
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                await onComplete(data)
                setSaving(false)
              }}
            >
              {saving ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
              פתח שיחה עם העוזר
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('chat')
  const [runtime, setRuntime] = useState<HermesRuntime | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState('')
  const [runtimeSession, setRuntimeSession] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [activities, setActivities] = useState<Activity[]>([])
  const [approval, setApproval] = useState<Approval | null>(null)
  const [clarify, setClarify] = useState<ClarifyRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [connections, setConnections] = useState(CONNECTIONS)
  const [versions, setVersions] = useState<Record<string, string>>({})
  const [modal, setModal] = useState<'task' | 'skill' | 'provider' | null>(null)
  const [connectionModal, setConnectionModal] = useState<Connection | null>(null)
  const [checking, setChecking] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<HermesUpdateStatus | null>(null)
  const [updating, setUpdating] = useState(false)
  const [toast, setToast] = useState('')
  const [windowState, setWindowState] = useState<AssistantWindowState>({
    mode: 'full',
    alwaysOnTop: false,
    visible: true
  })
  const forceOnboarding = new URLSearchParams(window.location.search).get('onboarding') === '1'
  const [showOnboarding, setShowOnboarding] = useState(
    forceOnboarding || (!hermesClient.demo && localStorage.getItem('hermes-business-onboarding-v1') !== 'complete')
  )

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
        setConnections(
          hydrateConnectionStates(CONNECTIONS, messaging, googleStatus.authenticated)
        )
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

  useEffect(() => {
    if (!window.hermesDesktop) return
    void window.hermesDesktop.getWindowState().then(setWindowState)
  }, [])

  useEffect(() => {
    if (!showOnboarding || !window.hermesDesktop || windowState.mode !== 'mini') return
    void window.hermesDesktop.setWindowMode('full').then(setWindowState)
  }, [showOnboarding, windowState.mode])

  useEffect(() => {
    return hermesClient.onEvent(event => {
      if (event.session_id && event.session_id !== runtimeSession) return
      const payload = event.payload || {}
      if (event.type === 'message.start') {
        setBusy(true)
        setMessages(current => [
          ...current.filter(message => !message.streaming),
          { id: `assistant-${Date.now()}`, role: 'assistant', text: '', streaming: true }
        ])
      }
      if (event.type === 'message.delta') {
        setMessages(current =>
          current.map((message, index) =>
            index === current.length - 1 && message.streaming
              ? { ...message, text: `${message.text}${String(payload.text || '')}` }
              : message
          )
        )
      }
      if (event.type === 'message.complete') {
        const finalText = String(payload.text || '')
        setBusy(false)
        setMessages(current =>
          current.map((message, index) =>
            index === current.length - 1 && message.streaming
              ? { ...message, text: finalText || message.text, streaming: false, time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) }
              : message
          )
        )
      }
      if (event.type === 'tool.start') {
        const tool = String(payload.name || '')
        setActivities(current => [
          ...current,
          {
            id: String(payload.tool_id || Date.now()),
            tool,
            label: humanizeTool(tool),
            status: 'running'
          }
        ])
      }
      if (event.type === 'tool.complete') {
        const id = String(payload.tool_id || '')
        setActivities(current =>
          current.map(item =>
            item.id === id ? { ...item, status: 'done', detail: String(payload.summary || 'הושלם') } : item
          )
        )
      }
      if (event.type === 'status.update') {
        const text = String(payload.text || '')
        if (text) {
          setActivities(current => [
            ...current.filter(item => !item.id.startsWith('status-')),
            { id: `status-${Date.now()}`, tool: 'status', label: text, status: 'running' }
          ])
        }
      }
      if (event.type === 'approval.request') {
        const copy = approvalCopy(payload)
        setApproval({
          id: `approval-${Date.now()}`,
          sessionId: event.session_id || runtimeSession,
          title: copy.title,
          description: copy.description,
          command: payload.command ? String(payload.command) : undefined,
          choices: Array.isArray(payload.choices) ? payload.choices.map(String) : ['once', 'deny']
        })
      }
      if (event.type === 'clarify.request') {
        setClarify({
          requestId: String(payload.request_id || ''),
          sessionId: event.session_id || runtimeSession,
          question: String(payload.question || 'מה חשוב שאדע כדי להמשיך?'),
          choices: Array.isArray(payload.choices) ? payload.choices.map(String) : [],
          multiSelect: Boolean(payload.multi_select)
        })
      }
      if (event.type === 'clarify.expire') {
        setClarify(current =>
          current?.requestId === String(payload.request_id || '') ? null : current
        )
      }
      if (event.type === 'error') {
        setBusy(false)
        setToast(String(payload.message || 'Hermes נתקל בבעיה'))
      }
    })
  }, [runtimeSession])

  const selectSession = useCallback(async (session: Session) => {
    setScreen('chat')
    setActiveSession(session.id)
    setActivities([])
    setApproval(null)
    setClarify(null)
    try {
      const resumed = await hermesClient.resumeSession(session.id)
      setRuntimeSession(resumed.session_id)
      const hydrated = (resumed.messages || [])
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .map((message, index) => ({
          id: `${session.id}-${index}`,
          role: message.role as 'user' | 'assistant',
          text: String(message.content || message.text || '')
        }))
      setMessages(hydrated)
    } catch {
      setMessages([])
      setRuntimeSession(session.id)
    }
  }, [])

  const newSession = useCallback(async () => {
    setScreen('chat')
    setBusy(true)
    try {
      const created = await hermesClient.createSession()
      setRuntimeSession(created.session_id)
      setActiveSession(created.stored_session_id)
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          text: 'היי, אני כאן. במה נתחיל?'
        }
      ])
      setActivities([])
      setApproval(null)
      setClarify(null)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'לא ניתן לפתוח שיחה חדשה')
    } finally {
      setBusy(false)
    }
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      let sid = runtimeSession
      if (!sid) {
        const created = await hermesClient.createSession()
        sid = created.session_id
        setRuntimeSession(sid)
      }
      setMessages(current => [
        ...current,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          text,
          time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
        }
      ])
      setActivities([])
      setApproval(null)
      setClarify(null)
      setBusy(true)
      try {
        await hermesClient.submit(sid, text)
      } catch (error) {
        setBusy(false)
        setToast(error instanceof Error ? error.message : 'שליחת ההודעה נכשלה')
      }
    },
    [runtimeSession]
  )

  const respondApproval = useCallback(
    async (choice: 'once' | 'deny') => {
      if (!approval) return
      await hermesClient.respondApproval(approval.sessionId, choice)
      setApproval(null)
      setToast(choice === 'once' ? 'הפעולה אושרה' : 'הפעולה נדחתה')
      window.setTimeout(() => setToast(''), 2500)
    },
    [approval]
  )

  const respondClarify = useCallback(
    async (answer: string) => {
      if (!clarify) return
      await hermesClient.respondClarify(clarify.requestId, answer)
      setMessages(current => [
        ...current,
        {
          id: `clarify-${Date.now()}`,
          role: 'user',
          text: answer,
          time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
        }
      ])
      setClarify(null)
    },
    [clarify]
  )

  const openFull = useCallback((surface: 'desktop' | 'dashboard' | 'logs' | 'settings') => {
    if (window.hermesDesktop) {
      void window.hermesDesktop.openFull(surface)
    } else {
      setToast(`ביישום המותקן ייפתח כעת ${surface}`)
      window.setTimeout(() => setToast(''), 2500)
    }
  }, [])

  const enterMini = useCallback(async () => {
    setScreen('chat')
    if (window.hermesDesktop) {
      setWindowState(await window.hermesDesktop.setWindowMode('mini'))
    }
  }, [])

  const expandWindow = useCallback(async () => {
    if (window.hermesDesktop) {
      setWindowState(await window.hermesDesktop.setWindowMode('full'))
    }
  }, [])

  const togglePinned = useCallback(async () => {
    if (window.hermesDesktop) {
      setWindowState(await window.hermesDesktop.setAlwaysOnTop(!windowState.alwaysOnTop))
    }
  }, [windowState.alwaysOnTop])

  const hideWindow = useCallback(async () => {
    if (window.hermesDesktop) {
      setWindowState(await window.hermesDesktop.hideWindow())
    }
  }, [])

  const title = screen === 'chat' ? sessions.find(item => item.id === activeSession)?.title || 'שיחה חדשה' : NAV_ITEMS.find(item => item.id === screen)?.label || ''

  const main = (() => {
    if (screen === 'tasks') {
      return (
        <TasksScreen
          tasks={tasks}
          onAdd={() => setModal('task')}
          onToggle={async task => {
            await hermesClient.toggleTask(task)
            setTasks(current => current.map(item => (item.id === task.id ? { ...item, enabled: !item.enabled } : item)))
          }}
        />
      )
    }
    if (screen === 'skills') return <SkillsScreen skills={skills} onAdd={() => setModal('skill')} />
    if (screen === 'connections') {
      return <ConnectionsScreen connections={connections} onConnect={setConnectionModal} />
    }
    if (screen === 'support') {
      return (
        <SupportScreen
          runtime={runtime}
          versions={versions}
          tasks={tasks}
          connections={connections}
          checking={checking}
          toast={toast}
          onHealth={async () => {
            setChecking(true)
            try {
              await hermesClient.healthCheck()
              setToast('בדיקת התקינות הושלמה — הכול פועל כרגיל')
            } catch {
              setToast('נמצאה בעיה. אפשר לפתוח Logs או ליצור חבילת אבחון.')
            } finally {
              setChecking(false)
            }
          }}
          onRestart={async () => {
            if (window.hermesDesktop) setRuntime(await window.hermesDesktop.restartRuntime())
            setToast('Hermes הופעל מחדש')
          }}
          onLogs={() => openFull('logs')}
          onDiagnostics={async () => {
            if (window.hermesDesktop) {
              const result = await window.hermesDesktop.createDiagnostics()
              if (result.ok) setToast(`חבילת האבחון נשמרה: ${result.path}`)
            } else {
              setToast('חבילת אבחון בטוחה נוצרה בהצלחה (מצב הדגמה)')
            }
          }}
          updateStatus={updateStatus}
          updating={updating}
          onUpdateCheck={async () => {
            setUpdating(true)
            try {
              const result = await hermesClient.checkUpdate(true)
              setUpdateStatus(result)
              setToast(
                result.update_available
                  ? `נמצא עדכון Hermes${typeof result.behind === 'number' && result.behind > 0 ? ` (${result.behind} שינויים)` : ''}`
                  : result.message || 'Hermes מעודכן'
              )
            } catch {
              setToast('לא ניתן לבדוק עדכונים כרגע. לא בוצע שינוי.')
            } finally {
              setUpdating(false)
            }
          }}
          onUpdateApply={async () => {
            if (!window.confirm('לעדכן את Hermes כעת? Hermes ייצור גיבוי ויבצע בדיקת תקינות בסיום.')) return
            setUpdating(true)
            try {
              const started = await hermesClient.startUpdate()
              if (!started.ok) throw new Error(started.message || 'Hermes לא התחיל את העדכון')
              let completed = false
              for (let attempt = 0; attempt < 240; attempt += 1) {
                await new Promise(resolve => window.setTimeout(resolve, 1000))
                const action = await hermesClient.updateActionStatus().catch(() => null)
                if (!action || action.running) continue
                if (action.exit_code !== 0) throw new Error('עדכון Hermes נכשל')
                completed = true
                break
              }
              if (!completed) throw new Error('עדכון Hermes עדיין לא הסתיים')
              let healthy = false
              for (let attempt = 0; attempt < 60; attempt += 1) {
                try {
                  const { health } = await hermesClient.healthCheck()
                  if (health.ok) {
                    healthy = true
                    break
                  }
                } catch {
                  // The local server can briefly restart while Hermes updates.
                }
                await new Promise(resolve => window.setTimeout(resolve, 1000))
              }
              if (!healthy) throw new Error('Hermes עודכן, אך בדיקת התקינות טרם הצליחה')
              const checked = await hermesClient.checkUpdate(true)
              setUpdateStatus(checked)
              setToast('Hermes עודכן ובדיקת התקינות עברה בהצלחה')
            } catch (caught) {
              setToast(caught instanceof Error ? caught.message : 'העדכון נכשל; המידע של Hermes נשמר')
            } finally {
              setUpdating(false)
            }
          }}
        />
      )
    }
    return (
      <ChatScreen
        messages={messages}
        activities={activities}
        approval={approval}
        clarify={clarify}
        busy={busy}
        onSend={sendMessage}
        onStop={() => {
          void hermesClient.interrupt(runtimeSession)
          setBusy(false)
        }}
        onApproval={respondApproval}
        onClarify={respondClarify}
      />
    )
  })()

  if (showOnboarding) {
    return (
      <>
        <Onboarding
          runtime={runtime}
          onProvider={() => setModal('provider')}
          onComplete={async data => {
            const created = await hermesClient.createSession()
            const verifiedSnapshot = {
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
            const onboardingPrompt = [
              '/business-bootstrap',
              'המשך את הקמת העוזר לעסק.',
              'המעטפת ביצעה בדיקה תחומה דרך ה־APIs הרשמיים של Hermes. השתמש ב־snapshot הבא ואל תחזור על הבדיקות לפני השאלה הבאה.',
              'המשתמש מילא את פרטי ההיכרות הבאים במעטפת. שמור עובדות יציבות באמצעות מנגנוני Hermes המתאימים ועדכן את business-context Skill; אל תיצור System Prompt גדול.',
              'אל תבקש שוב מידע שכבר נמסר. לאחר השמירה, שאל רק את השאלה החסרה הבאה או המלץ על חיבור אחד בעל הערך המיידי הגבוה ביותר.',
              'אין לבצע פעולה חיצונית ואין לבקש secret בצ׳אט.',
              '',
              `WRAPPER_VERIFIED_SNAPSHOT=${JSON.stringify(verifiedSnapshot)}`,
              '',
              JSON.stringify(data, null, 2)
            ].join('\n')
            setScreen('chat')
            setRuntimeSession(created.session_id)
            setActiveSession(created.stored_session_id)
            setMessages([
              {
                id: `onboarding-${Date.now()}`,
                role: 'user',
                text: 'סיימתי את ההיכרות הראשונית. שמור אותה ב־Hermes והמשך איתי לשאלה הבאה.'
              }
            ])
            window.setTimeout(() => {
              void hermesClient.submit(created.session_id, onboardingPrompt).catch(error => {
                setBusy(false)
                setToast(error instanceof Error ? error.message : 'שמירת ההיכרות ב־Hermes נכשלה')
              })
            }, 300)
            localStorage.setItem('hermes-business-onboarding-v1', 'complete')
            setShowOnboarding(false)
            setToast('הפרטים נמסרו ל־Hermes; העוזר שומר אותם וממשיך איתך')
          }}
        />
        {modal === 'provider' ? (
          <ProviderModal
            onClose={() => setModal(null)}
            onConnect={async (provider, key) => {
              await hermesClient.connectProvider(provider, key)
              setToast('ספק ה־AI חובר בהצלחה')
            }}
          />
        ) : null}
      </>
    )
  }

  if (windowState.mode === 'mini') {
    return (
      <div className="mini-shell" dir="rtl">
        <MiniHeader
          runtime={runtime}
          pinned={windowState.alwaysOnTop}
          onNewSession={newSession}
          onTogglePin={togglePinned}
          onExpand={expandWindow}
          onHide={hideWindow}
        />
        <ChatScreen
          messages={messages}
          activities={activities}
          approval={approval}
          clarify={clarify}
          busy={busy}
          onSend={sendMessage}
          onStop={() => {
            void hermesClient.interrupt(runtimeSession)
            setBusy(false)
          }}
          onApproval={respondApproval}
          onClarify={respondClarify}
        />
        <div className="mini-powered">מופעל באמצעות Hermes</div>
        {toast ? (
          <div className="floating-toast floating-toast--mini">
            <CheckCircle2 size={15} /> {toast}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        screen={screen}
        setScreen={setScreen}
        sessions={sessions}
        activeSession={activeSession}
        onSelectSession={selectSession}
        onNewSession={newSession}
        runtime={runtime}
        taskCount={tasks.length}
      />
      <div className="app-main">
        <Topbar title={title} runtime={runtime} onOpenFull={openFull} onMini={enterMini} />
        {main}
      </div>
      {modal === 'task' ? (
        <TaskModal
          onClose={() => setModal(null)}
          onCreate={async task => {
            await hermesClient.createTask(task)
            setTasks(await hermesClient.listTasks())
            setToast('המשימה נוצרה ותופיע גם ב־Hermes המלא')
          }}
        />
      ) : null}
      {modal === 'skill' ? (
        <SkillModal
          onClose={() => setModal(null)}
          onCreate={async (name, description) => {
            await hermesClient.createSkill(name, description)
            setSkills(await hermesClient.listSkills())
            setToast('ה־Skill נשמר וזמין גם ב־Hermes המלא')
          }}
        />
      ) : null}
      {modal === 'provider' ? (
        <ProviderModal
          onClose={() => setModal(null)}
          onConnect={async (provider, key) => {
            await hermesClient.connectProvider(provider, key)
            setToast('ספק ה־AI חובר בהצלחה')
          }}
        />
      ) : null}
      {connectionModal ? (
        <ConnectionModal
          connection={connectionModal}
          onClose={() => setConnectionModal(null)}
          onConnected={id => {
            setConnections(current =>
              current.map(connection => (connection.id === id ? { ...connection, state: 'connected' } : connection))
            )
            setToast('החיבור נשמר ב־Hermes')
          }}
        />
      ) : null}
      {toast && screen !== 'support' ? (
        <div className="floating-toast">
          <CheckCircle2 size={17} /> {toast}
        </div>
      ) : null}
    </div>
  )
}
