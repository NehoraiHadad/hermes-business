import React from 'react'
import { createRoot } from 'react-dom/client'
import { MakomForm } from '../../shared/makom-form.js'
const api = async (path, init) => {
  const response = await fetch('/api/plugins/business-shell' + path, {
    method: init?.method || 'GET', headers: { 'Content-Type': 'application/json' },
    ...(init ? { body: JSON.stringify(init.body) } : {})
  })
  const value = await response.json()
  if (!response.ok) throw Error(value.detail || 'Connection failed')
  return value
}
createRoot(document.getElementById('root')).render(React.createElement(MakomForm, { api }))
