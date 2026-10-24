'use client'

import { useRef, useState } from 'react'

export function WorkspaceBreadcrumb({ section, record, onBack, disabled = false }: { section: string; record?: string; onHome?: () => void; onBack: () => void; disabled?: boolean }) {
  if (!record) return null
  return <nav className="admin-breadcrumb operations-breadcrumb" aria-label="Breadcrumb"><ol>
    <li><button type="button" disabled={disabled} onClick={onBack}>{section}</button></li>
    <li><span aria-current="page">{record}</span></li>
  </ol></nav>
}

export function WorkspaceStatusTabs({ values, value, onChange, label }: { values: readonly string[]; value: string; onChange: (value: string) => void; label: string }) {
  return <div className="operations-status-tabs" role="group" aria-label={label}>{values.map((status) => <button key={status} type="button" aria-pressed={status === value} className={status === value ? 'active' : ''} onClick={() => onChange(status)}>{status}</button>)}</div>
}

export function WorkspaceFilter({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const [search, setSearch] = useState('')
  const menu = useRef<globalThis.HTMLDetailsElement>(null)
  const selected = options.find((option) => option.value === value)
  const visible = options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()))
  return <details ref={menu} className="operations-filter-menu" onToggle={() => { if (!menu.current?.open) setSearch('') }}>
    <summary>{label}{value !== 'All' && <span>: {selected?.label ?? value}</span>}</summary>
    <div className="operations-filter-popover">
      <input type="search" aria-label={`Search ${label.toLowerCase()} filters`} placeholder={`Search ${label.toLowerCase()}…`} value={search} onChange={(event) => setSearch(event.target.value)} />
      <div role="group" aria-label={`${label} filter`}>{visible.length ? visible.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => { onChange(option.value); if (menu.current) menu.current.open = false }}>{option.label}</button>) : <p role="status">No matching filters.</p>}</div>
    </div>
  </details>
}
