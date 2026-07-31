import { Badge, Input, StatusDot, Textarea } from '@hermes/plugin-sdk'
import { h } from './dom.js'

// Reusable presentational primitives shared by every screen. Tailwind-in-string
// classes mirror the Hermes design tokens so the shell matches the host UI.

export function SectionTitle({ eyebrow, title, copy }) {
  return h(
    'div',
    { className: 'mb-4' },
    eyebrow
      ? h('div', { className: 'mb-1 text-[0.6875rem] font-semibold tracking-wide text-primary' }, eyebrow)
      : null,
    h('h2', { className: 'text-lg font-semibold text-(--ui-text-primary)' }, title),
    copy ? h('p', { className: 'mt-1 max-w-2xl text-xs leading-5 text-(--ui-text-tertiary)' }, copy) : null
  )
}

export function Card({ children, className = '' }) {
  return h(
    'section',
    {
      className: `rounded-[6px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4 ${className}`
    },
    children
  )
}

export function Metric({ label, value, tone = 'good' }) {
  return h(
    'div',
    { className: 'flex min-w-0 items-center gap-2' },
    h(StatusDot, { tone }),
    h(
      'div',
      { className: 'min-w-0' },
      h('div', { className: 'truncate text-xs font-medium text-(--ui-text-primary)' }, value),
      h('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)' }, label)
    )
  )
}

export function QuickAction({ icon, title, copy, onClick, badge }) {
  return h(
    'button',
    {
      type: 'button',
      onClick,
      className:
        'group flex min-h-28 flex-col items-start rounded-[6px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4 text-right transition-colors hover:bg-(--ui-bg-tertiary)'
    },
    h(
      'div',
      { className: 'mb-3 flex w-full items-start justify-between gap-2' },
      h('span', { className: 'text-xl', 'aria-hidden': true }, icon),
      badge ? h(Badge, { variant: 'muted' }, badge) : null
    ),
    h('strong', { className: 'text-sm text-(--ui-text-primary)' }, title),
    h('span', { className: 'mt-1 text-xs leading-5 text-(--ui-text-tertiary)' }, copy)
  )
}

export function Field({ label, name, value, onChange, multiline = false, placeholder = '' }) {
  const Component = multiline ? Textarea : Input
  return h(
    'label',
    { className: 'grid gap-1.5' },
    h('span', { className: 'text-xs font-medium text-(--ui-text-secondary)' }, label),
    h(Component, {
      name,
      value,
      placeholder,
      rows: multiline ? 3 : undefined,
      onChange: event => onChange(name, event.target.value)
    })
  )
}
