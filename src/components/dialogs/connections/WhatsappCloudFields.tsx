import { Copy } from 'lucide-react'

export function CloudField(props: {
  label: string
  value: string
  secret?: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="cloud-field">
      <span>{props.label}</span>
      <input
        dir="ltr"
        type={props.secret ? 'password' : 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={event => props.onChange(event.target.value)}
      />
    </label>
  )
}

export function CopyValue({
  label,
  value,
  secret = false
}: {
  label: string
  value: string
  secret?: boolean
}) {
  return (
    <div className="copy-value">
      <span>{label}</span>
      <code dir="ltr">{secret ? `${value.slice(0, 8)}…${value.slice(-6)}` : value}</code>
      <button aria-label={`העתק ${label}`} onClick={() => navigator.clipboard.writeText(value)}>
        <Copy size={15} />
      </button>
    </div>
  )
}
