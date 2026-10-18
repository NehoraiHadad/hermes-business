import React, { useState } from 'react'
import { Button } from '@hermes/plugin-sdk'
import { MakomForm } from '../../../../shared/makom-form.js'
import { makomRequest } from '../makom-source.js'
import { h } from '../dom.js'
import { Card } from '../ui.js'
export function MakomConnection() {
  const [open, setOpen] = useState(false)
  return h(Card, { className: 'mt-3' },
    h('h3', { className: 'text-sm font-semibold' }, 'מקום — מידע מהקהילה'),
    h('p', null, 'מידע ציבורי עדכני, שעות פעילות, אירועים ותפילות דרך כלי הקריאה של מקום.'),
    h(Button, { variant: 'outline', onClick: () => setOpen(value => !value), 'aria-expanded': open }, open ? 'סגירת החיבור' : 'חיבור וניהול מקום'),
    open ? h(MakomForm, { api: makomRequest }) : null)
}
