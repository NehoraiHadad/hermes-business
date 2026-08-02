import { CheckCircle2, LoaderCircle } from 'lucide-react'
import type { Activity } from '../../types'

export function ActivityStrip({ activity }: { activity: Activity }) {
  return (
    <div className="activity-strip">
      <div className="activity-row">
        {activity.status === 'running' ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <CheckCircle2 size={15} />
        )}
        <span>{activity.label}</span>
        {activity.detail ? <small>{activity.detail}</small> : null}
      </div>
    </div>
  )
}
