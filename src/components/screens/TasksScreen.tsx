import { CalendarClock, CheckCircle2, Clock3, Inbox, Pause, Pencil, Play, Plus, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
import { humanSchedule } from '../../lib/presentation'
import type { ScheduledTask, TaskActions } from '../../types'
import { TaskEditDialog } from '../dialogs/TaskEditDialog'

export function TasksScreen({
  tasks,
  actions,
  onAdd
}: {
  tasks: ScheduledTask[]
  actions: TaskActions
  onAdd: () => void
}) {
  const [editing, setEditing] = useState<ScheduledTask | null>(null)
  const nextRun = tasks.find(task => task.enabled && task.next_run)?.next_run || '—'

  // Destructive/irreversible actions confirm first (delete permanently removes
  // the job; trigger fires a real run now). Editing opens a prefilled dialog.
  const confirmTrigger = (task: ScheduledTask) => {
    if (window.confirm(`להריץ עכשיו את "${task.name}"? Hermes יבצע את המשימה מיד.`)) actions.onTrigger(task)
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
