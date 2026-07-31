import { Eye, LoaderCircle, MessageSquareLock, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { hermesClient } from '../../../lib/hermes-client'
import {
  DEFAULT_WHATSAPP_POLICY,
  chatsToText,
  validateWhatsappPolicy,
  type WhatsappPolicyMode
} from '../../../lib/whatsapp-policy'

// Fail-closed reply-policy chooser. Enforcement lives in the Hermes plugin and
// transport layers; this only records the operator's choice through the desktop
// bridge (default read-only). No mode here can make the agent answer on its own.
export function WhatsappPolicyForm() {
  const [mode, setMode] = useState<WhatsappPolicyMode>('read_only')
  const [chats, setChats] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const policy = hermesClient.demo
          ? DEFAULT_WHATSAPP_POLICY
          : (await window.hermesDesktop?.getWhatsappPolicy()) || DEFAULT_WHATSAPP_POLICY
        if (!active) return
        setMode(policy.mode)
        setChats(chatsToText(policy.reply_chats))
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'קריאת מדיניות WhatsApp נכשלה.')
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const save = async () => {
    const result = validateWhatsappPolicy(mode, chats)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setSaving(true)
    setError('')
    try {
      if (!hermesClient.demo) await window.hermesDesktop?.setWhatsappPolicy(result.policy)
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
        <MessageSquareLock size={18} /> מדיניות מענה (ברירת מחדל: קריאה בלבד)
      </h3>
      <label className={`policy-option ${mode === 'read_only' ? 'policy-option--active' : ''}`}>
        <input
          type="radio"
          name="wa-mode"
          checked={mode === 'read_only'}
          onChange={() => {
            setMode('read_only')
            setSaved(false)
          }}
        />
        <span>
          <Eye size={16} /> <strong>קריאה בלבד</strong>
          <small>העוזר קורא ושומר את ההודעות, אך לעולם לא שולח תשובה, תגובה או אישור קריאה.</small>
        </span>
      </label>
      <label className={`policy-option ${mode === 'selected_chats' ? 'policy-option--active' : ''}`}>
        <input
          type="radio"
          name="wa-mode"
          checked={mode === 'selected_chats'}
          onChange={() => {
            setMode('selected_chats')
            setSaved(false)
          }}
        />
        <span>
          <MessageSquareLock size={16} /> <strong>מענה לשיחות פרטיות נבחרות בלבד</strong>
          <small>רק המספרים שתזין למטה יקבלו מענה. כל השאר ייקראו וישמרו, אך לא ייענו.</small>
        </span>
      </label>
      {mode === 'selected_chats' ? (
        <label className="policy-chats">
          <span>מספרי WhatsApp מותרים, כולל קידומת מדינה (אחד בכל שורה או מופרדים בפסיק)</span>
          <textarea
            dir="ltr"
            rows={4}
            value={chats}
            onChange={event => {
              setChats(event.target.value)
              setSaved(false)
            }}
            placeholder="+972500000000&#10;15551234567"
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
