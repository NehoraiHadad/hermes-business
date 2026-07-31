import { CheckCircle2, LoaderCircle } from 'lucide-react'
import type { Activity } from '../../types'

export function ActivityStrip({ activities }: { activities: Activity[] }) {
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
