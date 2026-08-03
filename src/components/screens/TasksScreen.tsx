import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Inbox, Pause, Pencil, Play, Plus, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
import { humanSchedule } from '../../lib/presentation'
import type { PartnerFeed } from '../../lib/partner-feed'
import type { ScheduledTask, TaskActions } from '../../types'
import { TaskEditDialog } from '../dialogs/TaskEditDialog'
import { PartnerFeedPanel } from './PartnerFeedPanel'

export function TasksScreen({
  tasks,
  actions,
  onAdd,
  loadError,
  feed,
  feedLoading,
  onRefreshFeed,
  onOpenSession
}: {
  tasks: ScheduledTask[]
  actions: TaskActions
  onAdd: () => void
  // The last authoritative LIST read failed — tasks is an EMPTY placeholder, not a
  // proven-empty list. Must never render as "0 משימות"/no tasks; see useHermesData.
  loadError?: boolean
  // Partner-visibility feed (docs/specs/partner-feed.md §6.1: "פעילות ומשימות" is the
  // activity home, so the feed panel lives at the top of THIS screen).
  feed: PartnerFeed | null
  feedLoading: boolean
  onRefreshFeed: () => Promise<void>
  onOpenSession: (sessionId: string) => void
}) {
  const [editing, setEditing] = useState<ScheduledTask | null>(null)
  // Unknown, not zero/dash, while the read that would prove either value failed.
  const activeCount = loadError ? null : tasks.filter(task => task.enabled).length
  const nextRun = loadError ? null : tasks.find(task => task.enabled && task.next_run)?.next_run || '—'

  // Destructive/irreversible actions confirm first (delete permanently removes
  // the job; trigger fires a real run now). Editing opens a prefilled dialog.
  const confirmTrigger = (task: ScheduledTask) => {
    if (window.confirm(`להריץ עכשיו את "${task.name}"? Hermes יבצע את המשימה מיד.`)) {
      // Spec §11 stage 5 / §7 trigger 2: the user just made Hermes DO something —
      // refetch the feed so the new run shows up without waiting for the next
      // live-refresh tick. actions.onTrigger already catches its own errors
      // (useTaskActions) and never rejects, so this always resolves.
      void actions.onTrigger(task).then(() => void onRefreshFeed())
    }
  }
  const confirmDelete = (task: ScheduledTask) => {
    if (window.confirm(`למחוק לצמיתות את "${task.name}"? לא ניתן לשחזר.`)) actions.onDelete(task)
  }

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
      <PartnerFeedPanel
        feed={feed}
        loading={feedLoading}
        onRefresh={onRefreshFeed}
        onOpenSession={onOpenSession}
        onAddTask={onAdd}
      />
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-card__icon stat-card__icon--green">
            <Play size={18} />
          </span>
          <strong>{activeCount === null ? 'לא ידוע' : activeCount}</strong>
          <small>משימות פעילות</small>
        </div>
        <div className="stat-card">
          <span className="stat-card__icon stat-card__icon--amber">
            <Clock3 size={18} />
          </span>
          <strong>{nextRun === null ? 'לא ידוע' : nextRun}</strong>
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
          <span>{loadError ? 'לא ידוע' : `${tasks.length} משימות`}</span>
        </div>
        {loadError ? (
          <div className="list-state list-state--error">
            <span className="list-state__icon list-state__icon--error">
              <AlertTriangle size={20} />
            </span>
            <strong>לא הצלחנו לקרוא את המשימות המתוזמנות</strong>
            <p>ייתכן שהחיבור ל־Hermes נקטע. רעננו את החלון, או בדקו את מצב המערכת במסך התמיכה.</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="list-state">
            <span className="list-state__icon">
              <Inbox size={20} />
            </span>
            <strong>אין עדיין משימות מתוזמנות</strong>
            <p>משימה מתוזמנת פועלת גם כשהחלון סגור. אפשר להוסיף את הראשונה עכשיו.</p>
            <button className="outline-button outline-button--small" onClick={onAdd}>
              <Plus size={15} /> משימה חדשה
            </button>
          </div>
        ) : (
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
                  <button
                    className="outline-button outline-button--small"
                    onClick={() => confirmTrigger(task)}
                    title="הרץ עכשיו"
                  >
                    <Zap size={15} /> הרץ עכשיו
                  </button>
                  <button className="outline-button outline-button--small" onClick={() => actions.onToggle(task)}>
                    {task.enabled ? 'השהה' : 'הפעל'}
                  </button>
                  <button className="icon-button" onClick={() => setEditing(task)} title="עריכה" aria-label="עריכה">
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button icon-button--danger"
                    onClick={() => confirmDelete(task)}
                    title="מחיקה"
                    aria-label="מחיקה"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {editing ? (
        <TaskEditDialog
          task={editing}
          onClose={() => setEditing(null)}
          onSave={updates => actions.onEdit(editing, updates)}
        />
      ) : null}
    </main>
  )
}
