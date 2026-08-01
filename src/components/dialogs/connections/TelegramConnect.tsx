import { LoaderCircle, Send } from 'lucide-react'
import { useState } from 'react'
import { hermesClient } from '../../../lib/hermes-client'
import type { Connection } from '../../../types'
import { Modal } from '../../ui/Modal'
import { TelegramPolicyForm } from './TelegramPolicyForm'

// Telegram uses the built-in Hermes gateway — token + user id, no MCP.
export function TelegramConnect({
  connection,
  onClose,
  onConnected
}: {
  connection: Connection
  onClose: () => void
  onConnected: (id: string) => void
}) {
  const [token, setToken] = useState('')
  const [userId, setUserId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const connect = async () => {
    setSaving(true)
    setError('')
    try {
      // Fail closed: refuse to connect unless the reply-policy plugin is active,
      // so a live Telegram bot is never served without the read-only guard.
      if (!hermesClient.demo) await window.hermesDesktop?.ensureTelegramPolicy()
      await hermesClient.connectTelegram(token, userId)
      onConnected(connection.id)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'החיבור נכשל')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="חיבור Telegram" subtitle="Hermes ישתמש ב־Gateway המובנה — אין צורך ב־MCP." onClose={onClose}>
      <div className="setup-steps">
        <div className="setup-instruction">
          <span>1</span>
          <p>
            פתח את <strong>@BotFather</strong> ב־Telegram ושלח <code>/newbot</code>.
          </p>
        </div>
        <div className="setup-instruction">
          <span>2</span>
          <p>הדבק כאן את ה־token שקיבלת ואת מזהה המשתמש שלך.</p>
        </div>
      </div>
      <TelegramPolicyForm />
      <div className="modal-form">
        <label>
          <span>Bot token</span>
          <input type="password" dir="ltr" value={token} onChange={event => setToken(event.target.value)} />
        </label>
        <label>
          <span>Telegram user ID</span>
          <input dir="ltr" value={userId} onChange={event => setUserId(event.target.value)} placeholder="123456789" />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal__actions">
          <button className="ghost-button" onClick={onClose}>
            ביטול
          </button>
          <button className="primary-button" disabled={!token || !userId || saving} onClick={connect}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} חבר Telegram
          </button>
        </div>
      </div>
    </Modal>
  )
}
