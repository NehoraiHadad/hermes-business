import { Briefcase, User } from 'lucide-react'

// Normal vs. Business Partner selector, reused by onboarding and settings. Pure
// presentational: the caller owns persistence and the (heavier) apply flow.
export function PartnerModeSelector({
  mode,
  onChange,
  disabled
}: {
  mode: PartnerMode
  onChange: (mode: PartnerMode) => void
  disabled?: boolean
}) {
  return (
    <div className="partner-mode-selector" role="radiogroup" aria-label="מצב עבודה">
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'normal'}
        className={`partner-mode-card ${mode === 'normal' ? 'partner-mode-card--active' : ''}`}
        onClick={() => onChange('normal')}
        disabled={disabled}
      >
        <User size={20} />
        <strong>עוזר רגיל</strong>
        <span>מגיב לבקשות שלך, שומר על אישורים ידניים. ברירת המחדל.</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'partner'}
        className={`partner-mode-card ${mode === 'partner' ? 'partner-mode-card--active' : ''}`}
        onClick={() => onChange('partner')}
        disabled={disabled}
      >
        <Briefcase size={20} />
        <strong>שותף עסקי</strong>
        <span>יוזם, מאתגר, חוקר ומציע — אף פעם לא שולח, מוציא כסף או מוחק בלי אישורך.</span>
      </button>
    </div>
  )
}
