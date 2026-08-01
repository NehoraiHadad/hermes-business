import { Eye, Globe, LoaderCircle, MessageSquareLock, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { hermesClient } from '../../../lib/hermes-client'
import {
  DEFAULT_TELEGRAM_POLICY,
  telegramChatsToText,
  validateTelegramPolicy,
  type TelegramPolicyMode
} from '../../../lib/telegram-policy'

// Fail-closed reply-policy chooser for Telegram. Enforcement lives in the Hermes
// plugin + transport guards; this only records the operator's choice through the
// desktop bridge. The safest option is read-only and it is always the default.
export function TelegramPolicyForm() {
  const [mode, setMode] = useState<TelegramPolicyMode>('read_only')
  const [chats, setChats] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const policy = hermesClient.demo
          ? DEFAULT_TELEGRAM_POLICY
          : (await window.hermesDesktop?.getTelegramPolicy()) || DEFAULT_TELEGRAM_POLICY
        if (!active) return
        setMode(policy.mode)
        setChats(telegramChatsToText(policy.reply_chats))
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'קריאת מדיניות Telegram נכשלה.')
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const pick = (next: TelegramPolicyMode) => () => {
    setMode(next)
    setSaved(false)
  }

  const save = async () => {
    const result = validateTelegramPolicy(mode, chats)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setSaving(true)
    setError('')
    try {
      if (!hermesClient.demo) await window.hermesDesktop?.setTelegramPolicy(result.policy)
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'שמירת המדיניות נכשלה.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="whatsapp-policy">
      <h3>
        <MessageSquareLock size={18} /> מדיניות מענה ל־Telegram (ברירת מחדל: קריאה בלבד)
      </h3>
      <label className={`policy-option ${mode === 'read_only' ? 'policy-option--active' : ''}`}>
        <input type="radio" name="tg-mode" checked={mode === 'read_only'} onChange={pick('read_only')} />
        <span>
          <Eye size={16} /> <strong>קריאה בלבד</strong>
          <small>העוזר קורא ושומר את ההודעות, אך לעולם לא שולח תשובה, תגובה או אישור.</small>
        </span>
      </label>
      <label className={`policy-option ${mode === 'selected_chats' ? 'policy-option--active' : ''}`}>
        <input
          type="radio"
          name="tg-mode"
          checked={mode === 'selected_chats'}
          onChange={pick('selected_chats')}
        />
        <span>
          <MessageSquareLock size={16} /> <strong>מענה למשתמשים/קבוצות נבחרים בלבד</strong>
          <small>רק המזהים שתזין למטה יקבלו מענה. כל השאר ייקראו וישמרו, אך לא ייענו.</small>
        </span>
      </label>
      <label className={`policy-option ${mode === 'full_access' ? 'policy-option--active' : ''}`}>
        <input type="radio" name="tg-mode" checked={mode === 'full_access'} onChange={pick('full_access')} />
        <span>
          <Globe size={16} /> <strong>גישה מלאה</strong>
          <small>העוזר עונה לכל משתמש שמורשה על ידי Telegram/Hermes. השתמש בזהירות.</small>
        </span>
      </label>
      {mode === 'selected_chats' ? (
        <label className="policy-chats">
          <span>מזהי Telegram מותרים — מזהה משתמש מספרי, מזהה קבוצה (מתחיל ב־<code>-</code>) או <code>@username</code></span>
          <textarea
            dir="ltr"
            rows={4}
            value={chats}
            onChange={event => {
              setChats(event.target.value)
              setSaved(false)
            }}
            placeholder="123456789&#10;-1001234567890&#10;@my_channel"
          />
        </label>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-button" disabled={saving} onClick={save}>
        {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
        {saved ? ' נשמר' : ' שמור מדיניות'}
      </button>
    </div>
  )
}
