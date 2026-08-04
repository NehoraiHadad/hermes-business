import { CheckCircle2, ExternalLink, Info } from 'lucide-react'
import { hermesClient } from '../../../lib/hermes-client'
import type { ProviderOption } from '../../../lib/provider-catalog'

// Display-only card for `flow: "external"` providers (and any unrecognized
// flow, which falls back here): the connection is managed by an outside CLI
// (Qwen CLI, Copilot, Claude Code, ...), so there is no in-app form — we show
// what it is, the command that manages it, and Hermes' current login snapshot.
export function ExternalProviderCard({ option }: { option: ProviderOption }) {
  return (
    <div className="modal-form">
      <div className="info-inline">
        {option.loggedIn ? <CheckCircle2 size={18} /> : <Info size={18} />}
        <span>
          {option.loggedIn
            ? 'החיבור הזה כבר פעיל לפי Hermes.'
            : 'הספק הזה מתחבר דרך כלי חיצוני, לא מתוך תכל׳ס.'}
        </span>
      </div>
      {option.cliCommand ? (
        <p className="form-hint">
          מתחברים בהרצת הפקודה הבאה בטרמינל:{' '}
          <code dir="ltr">{option.cliCommand}</code>
        </p>
      ) : (
        <p className="form-hint">ההתחברות מנוהלת אצל הספק עצמו.</p>
      )}
      {option.docsUrl ? (
        <button
          type="button"
          className="ghost-button"
          onClick={() => void hermesClient.openExternal(option.docsUrl!).catch(() => undefined)}
        >
          <ExternalLink size={16} /> מידע נוסף באתר הספק
        </button>
      ) : null}
    </div>
  )
}
