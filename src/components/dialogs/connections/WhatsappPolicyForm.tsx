import { Eye, LoaderCircle, MessageSquareLock, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { hermesClient } from '../../../lib/hermes-client'
import {
  DEFAULT_WHATSAPP_POLICY,
  buildWhatsappPolicy,
  type WhatsappBehavior,
  type WhatsappPlatform,
  type WhatsappPolicyMode,
  type WhatsappSource
} from '../../../lib/whatsapp-policy'
import { WhatsappSourcePicker } from './WhatsappSourcePicker'

// Fail-closed reply-policy chooser. Enforcement lives in the Hermes plugin and
// transport layers; this only records the operator's choice through the desktop
// bridge (default read-only). No mode here can make the agent answer on its own.
export function WhatsappPolicyForm({
  groupsEnabled = true,
  platform = 'whatsapp'
}: { groupsEnabled?: boolean; platform?: WhatsappPlatform }) {
  const [mode, setMode] = useState<WhatsappPolicyMode>('read_only')
  const [behavior, setBehavior] = useState<WhatsappBehavior>('monitor')
  const [instructions, setInstructions] = useState('')
  const [selected, setSelected] = useState<WhatsappSource[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const policy = (await hermesClient.getWhatsappPolicy()) || DEFAULT_WHATSAPP_POLICY
        if (!active) return
        setMode(policy.mode)
        setBehavior(policy.behavior || 'monitor')
        setInstructions(policy.instructions || '')
        setSelected(policy.sources || [])
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
    const result = buildWhatsappPolicy(mode, selected, behavior, instructions)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setSaving(true)
    setError('')
    try {
      await hermesClient.setWhatsappPolicy(result.policy)
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
          <MessageSquareLock size={16} /> <strong>מעקב ומענה בשיחות וקבוצות נבחרות</strong>
          <small>בחר לפי שם. Hermes יקבל רק את המקורות שנבחרו ויחיל את כללי הפעולה והאישורים שלו.</small>
        </span>
      </label>
      {mode === 'selected_chats' ? (
        <>
          <WhatsappSourcePicker
            platform={platform}
            selected={selected.filter(source => source.platform === platform).map(source => source.id)}
            groupsEnabled={groupsEnabled}
            onChange={sources => {
              setSelected(current => [
                ...current.filter(source => source.platform !== platform),
                ...sources
              ])
              setSaved(false)
            }}
          />
          {!groupsEnabled ? <small className="form-hint">קבוצות זמינות בחיבור WhatsApp Web/QR בלבד.</small> : null}
          <div className="whatsapp-behavior">
            <strong>איך העוזר יתנהג במקורות שבחרת?</strong>
            <label>
              <input type="radio" checked={behavior === 'monitor'} onChange={() => { setBehavior('monitor'); setSaved(false) }} />
              <span><b>מעקב והצעות לבעל העסק</b><small>שומר ידע ומזהה צורך בפגישה או במעקב, בלי לענות אוטומטית בצ׳אט.</small></span>
            </label>
            <label>
              <input type="radio" checked={behavior === 'assist'} onChange={() => { setBehavior('assist'); setSaved(false) }} />
              <span><b>סיוע פעיל</b><small>רשאי לענות ולבצע פעולות שהותרו; אישורי Hermes ממשיכים לחול.</small></span>
            </label>
            <label className="policy-chats">
              <span>מה חשוב לזהות או לעשות? אפשר לכתוב בשפה חופשית.</span>
              <textarea rows={3} value={instructions} onChange={event => { setInstructions(event.target.value); setSaved(false) }} placeholder="לדוגמה: לזהות בקשות לפגישה, לבדוק זמינות ביומן ולהזכיר לי על לקוחות שממתינים למענה." />
            </label>
          </div>
        </>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={saving} onClick={save}>
        {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
        {saved ? ' נשמר' : ' שמור מדיניות'}
      </button>
    </div>
  )
}
