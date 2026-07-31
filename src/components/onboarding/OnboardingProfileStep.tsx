import type { OnboardingData } from '../../types'
import { OnboardingPartnerChoice } from './OnboardingPartnerChoice'

const APPROVAL_OPTIONS = [
  'שליחת הודעות ומיילים',
  'מחיקה או שינוי קבצים',
  'התחייבות כספית'
]

type Props = {
  data: OnboardingData
  patch: (values: Partial<OnboardingData>) => void
}

export function ProfileStep({ data, patch }: Props) {
  const toggleApproval = (item: string, checked: boolean) => {
    patch({
      approvals: checked
        ? [...new Set([...data.approvals, item])]
        : data.approvals.filter(value => value !== item)
    })
  }

  return (
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
          <span>שעות העבודה שלך</span>
          <input
            value={data.workHours}
            onChange={event => patch({ workHours: event.target.value })}
            placeholder="09:00–18:00, ימים א׳–ה׳"
          />
        </label>
        <fieldset className="approval-grid">
          <legend>פעולות שתמיד דורשות את אישורך</legend>
          {APPROVAL_OPTIONS.map(item => (
            <label key={item}>
              <input
                type="checkbox"
                checked={data.approvals.includes(item)}
                onChange={event => toggleApproval(item, event.target.checked)}
              />
              <span>{item}</span>
            </label>
          ))}
        </fieldset>
        <label>
          <span>מה הכי היית רוצה לחסוך?</span>
          <textarea
            rows={2}
            value={data.timeSavers}
            onChange={event => patch({ timeSavers: event.target.value })}
            placeholder="מעקב אחרי לידים, סיכומי בוקר או מענה ראשוני"
          />
        </label>
        <OnboardingPartnerChoice />
      </div>
    </div>
  )
}
