import avatarUrl from '../../assets/tahlas-chat-avatar.png'

// Compact companion mark derived from the main identity and optimized for the
// 25–30px avatar beside assistant messages.
export function AssistantMark({ className }: { className?: string }) {
  return <img className={className} src={avatarUrl} alt="" role="presentation" />
}
