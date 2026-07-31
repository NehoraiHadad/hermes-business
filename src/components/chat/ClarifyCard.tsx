import { CircleHelp } from 'lucide-react'
import { useState } from 'react'
import type { ClarifyRequest } from '../../types'

export function ClarifyCard({
  request,
  onRespond
}: {
  request: ClarifyRequest
  onRespond: (answer: string) => void
}) {
  const [answer, setAnswer] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const toggle = (choice: string) => {
    setSelected(current =>
      current.includes(choice) ? current.filter(item => item !== choice) : [...current, choice]
    )
  }
  return (
    <div className="approval-card clarify-card">
      <div className="approval-card__icon">
        <CircleHelp size={20} />
      </div>
      <div className="approval-card__body">
        <strong>כדי להמשיך, העוזר צריך לדעת:</strong>
        <p>{request.question}</p>
        {request.choices.length ? (
          <div className="approval-card__actions">
            {request.choices.map(choice => (
              <button
                key={choice}
                className={
                  request.multiSelect && selected.includes(choice)
                    ? 'primary-button primary-button--small'
                    : 'outline-button outline-button--small'
                }
                onClick={() => (request.multiSelect ? toggle(choice) : onRespond(choice))}
              >
                {choice}
              </button>
            ))}
            {request.multiSelect ? (
              <button
                className="primary-button primary-button--small"
                disabled={!selected.length}
                onClick={() => onRespond(JSON.stringify(selected))}
              >
                המשך
              </button>
            ) : null}
          </div>
        ) : null}
        <form
          className="modal-form"
          onSubmit={event => {
            event.preventDefault()
            if (answer.trim()) onRespond(answer.trim())
          }}
        >
          <label>
            <span>{request.choices.length ? 'תשובה אחרת' : 'התשובה שלך'}</span>
            <input value={answer} onChange={event => setAnswer(event.target.value)} />
          </label>
          <button className="primary-button primary-button--small" disabled={!answer.trim()}>
            שלח תשובה
          </button>
        </form>
      </div>
    </div>
  )
}
