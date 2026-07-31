export function StatusPill({ runtime, demo }: { runtime: HermesRuntime | null; demo: boolean }) {
  const online = Boolean(runtime?.running)
  return (
    <div className={`status-pill ${online ? 'status-pill--online' : ''}`}>
      <span className="status-pill__dot" />
      {demo ? 'מצב הדגמה' : online ? 'העוזר זמין' : runtime?.starting ? 'העוזר מתכונן…' : 'העוזר לא זמין'}
    </div>
  )
}
