import { FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { ChatMessage } from '../../types'
import { AssistantMark } from '../ui/AssistantMark'

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`message message--${message.role}`}>
      {message.role === 'assistant' ? (
        <div className="assistant-avatar">
          <AssistantMark />
        </div>
      ) : null}
      <div className="message__content">
        <div className="message__bubble">
          {message.attachment ? (
            <div className="message-attachment">
              <FileText size={18} />
              <span>
                <strong>{message.attachment.name}</strong>
                <small>{message.attachment.size}</small>
              </span>
            </div>
          ) : null}
          <ReactMarkdown>{message.text || (message.streaming ? ' ' : '')}</ReactMarkdown>
          {message.streaming ? <span className="typing-cursor" /> : null}
        </div>
        {message.time ? <time>{message.time}</time> : null}
      </div>
    </article>
  )
}
