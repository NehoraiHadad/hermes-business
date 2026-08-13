import { AlertTriangle, CalendarClock, Clock3, Inbox, Pause, Pencil, Play, Plus, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
import { humanSchedule } from '../../lib/presentation'
import type { PartnerFeed } from '../../lib/partner-feed'
import type { ScheduledTask, TaskActions } from '../../types'
import { ConfirmDialog } from '../ui/ConfirmDialog'
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
  // Pending confirmation for a consequential action — set by the row buttons below,
  // rendered as a ConfirmDialog (house Modal-based dialog, never window.confirm())
  // near the bottom of this component, cleared on confirm or cancel.
  const [confirmingTrigger, setConfirmingTrigger] = useState<ScheduledTask | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<ScheduledTask | null>(null)
  // Unknown, not zero/dash, while the read that would prove either value failed.
  const activeCount = loadError ? null : tasks.filter(task => task.enabled).length
  const nextRun = loadError ? null : tasks.find(task => task.enabled && task.next_run)?.next_run || '—'
  const pausedCount = loadError ? null : tasks.filter(task => !task.enabled).length

  // Destructive/irreversible actions confirm first (delete permanently removes
  // the job; trigger fires a real run now). Editing opens a prefilled dialog.
  const runTrigger = (task: ScheduledTask) => {
    // Spec §11 stage 5 / §7 trigger 2: the user just made Hermes DO something —
    // refetch the feed so the new run shows up without waiting for the next
    // live-refresh tick. actions.onTrigger already catches its own errors
    // (useTaskActions) and never rejects, so this always resolves.
    void actions.onTrigger(task).then(() => void onRefreshFeed())
  }

  return (
    <main className="content-screen">
      {/* Heading now matches the nav label ("פעילות ומשימות", src/constants.ts:21) so it
          honestly covers BOTH sections rendered under it — the activity feed right below
          (spec §6.1) and the scheduled-tasks list further down. Each section carries its
          own h3 (PartnerFeedPanel's "מה השותף עשה בשבילך"; "כל המשימות" below), so the
          heading outline stays valid: h2 page → h3 per section. The "משימה חדשה" action
          moved into the tasks panel's own title bar below so it visibly belongs to the
          tasks section, not to this now-broader page heading. */}
      <section className="page-heading">
        <div>
          <h2>פעילות ומשימות</h2>
          <p>מה Hermes עשה בשבילכם, ורשימת המשימות המתוזמנות שהוא מריץ.</p>
        </div>
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
            <Pause size={18} />
          </span>
          {/* Computed only from `tasks`, same fail-closed rule as activeCount/nextRun
              above: while the authoritative read failed, `tasks` is an empty placeholder,
              never a proven-empty list — this must render "לא ידוע", never a confident 0. */}
          <strong>{pausedCount === null ? 'לא ידוע' : pausedCount}</strong>
          <small>משימות מושהות</small>
        </div>
      </div>
      <section className="panel">
        <div className="panel__title">
          <h3>כל המשימות</h3>
          <div className="panel__title-actions">
            <span>{loadError ? 'לא ידוע' : `${tasks.length} משימות`}</span>
            <button className="primary-button" onClick={onAdd}>
              <Plus size={15} /> משימה חדשה
            </button>
          </div>
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
                    onClick={() => setConfirmingTrigger(task)}
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
                    onClick={() => setConfirmingDelete(task)}
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
      {confirmingTrigger ? (
        <ConfirmDialog
          title="הרצה עכשיו"
          message={`להריץ עכשיו את "${confirmingTrigger.name}"? Hermes יבצע את המשימה מיד.`}
          confirmLabel="הרץ עכשיו"
          onConfirm={() => {
            runTrigger(confirmingTrigger)
            setConfirmingTrigger(null)
          }}
          onCancel={() => setConfirmingTrigger(null)}
        />
      ) : null}
      {confirmingDelete ? (
        <ConfirmDialog
          title="מחיקת משימה"
          message={`למחוק לצמיתות את "${confirmingDelete.name}"? לא ניתן לשחזר.`}
          confirmLabel="מחיקה לצמיתות"
          destructive
          onConfirm={() => {
            actions.onDelete(confirmingDelete)
            setConfirmingDelete(null)
          }}
          onCancel={() => setConfirmingDelete(null)}
        />
      ) : null}
    </main>
  )
}
