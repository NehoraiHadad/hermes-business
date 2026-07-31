import { FileText, Image as ImageIcon } from 'lucide-react'
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
          {message.attachments?.map((attachment, index) => (
            <div className="message-attachment" key={`${message.id}-att-${index}`}>
              {attachment.kind === 'image' ? <ImageIcon size={18} /> : <FileText size={18} />}
              <span>
                <strong>{attachment.name}</strong>
                {attachment.size ? <small>{attachment.size}</small> : null}
              </span>
            </div>
          ))}
          <ReactMarkdown>{message.text || (message.streaming ? ' ' : '')}</ReactMarkdown>
          {message.streaming ? <span className="typing-cursor" /> : null}
        </div>
        {message.time ? <time>{message.time}</time> : null}
      </div>
    </article>
  )
}
