import { CalendarClock, CheckCircle2, Clock3, Inbox, MoreHorizontal, Pause, Play, Plus, Zap } from 'lucide-react'
import { humanSchedule } from '../../lib/presentation'
import type { ScheduledTask } from '../../types'

export function TasksScreen({
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
