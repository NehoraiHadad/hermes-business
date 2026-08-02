import { RefreshCw, Search, UserRound, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { WhatsappPlatform, WhatsappSource } from '../../../lib/whatsapp-policy'

export function WhatsappSourcePicker({
  selected,
  platform,
  groupsEnabled = true,
  onChange
}: {
  selected: string[]
  platform: WhatsappPlatform
  groupsEnabled?: boolean
  onChange: (sources: WhatsappSource[]) => void
}) {
  const [sources, setSources] = useState<WhatsappSource[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setSources((await window.hermesDesktop?.getWhatsappDirectory()) || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const platformSources = sources.filter(source => source.platform === platform)
  const visible = platformSources.filter(source =>
    (groupsEnabled || source.type === 'dm') &&
    source.name.toLocaleLowerCase('he').includes(query.trim().toLocaleLowerCase('he'))
  )

  const toggle = (source: WhatsappSource) => {
    const nextIds = new Set(selected)
    if (nextIds.has(source.id)) nextIds.delete(source.id)
    else nextIds.add(source.id)
    const known = new Map(platformSources.map(item => [item.id, item]))
    onChange([...nextIds].map(id => known.get(id) || {
      id, name: 'בחירה שמורה', type: id.endsWith('@g.us') ? 'group' : 'dm', platform
    }))
  }

  return (
    <div className="whatsapp-source-picker">
      <div className="whatsapp-source-picker__toolbar">
        <label>
          <Search size={15} />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="חיפוש לפי שם שיחה או קבוצה"
          />
        </label>
        <button type="button" className="ghost-button" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> רענן
        </button>
      </div>

      <div className="whatsapp-source-picker__list">
        {visible.map(source => (
          <label key={`${source.platform}:${source.id}`} className="whatsapp-source-row">
            <input type="checkbox" checked={selectedSet.has(source.id)} onChange={() => toggle(source)} />
            {source.type === 'group' ? <UsersRound size={18} /> : <UserRound size={18} />}
            <span>
              <strong>{source.name}</strong>
              <small>{source.type === 'group' ? 'קבוצה' : 'שיחה פרטית'}</small>
            </span>
          </label>
        ))}
        {!loading && visible.length === 0 ? (
          <p className="whatsapp-source-picker__empty">
            עדיין אין שיחות מוכרות. לאחר שהודעה מתקבלת ב־Hermes, לחץ רענן והשיחה תופיע כאן.
          </p>
        ) : null}
      </div>
    </div>
  )
}
