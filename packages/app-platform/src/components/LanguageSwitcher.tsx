'use client'

import React, { useId } from 'react'
import { useLocale } from '../i18n/client'
import { getLocales } from '../locales'
import type { SupportedLocale } from '../types'

export interface LanguageSwitcherProps {
  className?: string
  showNativeName?: boolean
  iconOnly?: boolean
}

export function LanguageSwitcher({
  className = '',
  showNativeName = true,
  iconOnly = false,
}: LanguageSwitcherProps) {
  const { locale, setLocale } = useLocale()
  const locales = getLocales()
  const selectId = `nivasa-locale-select-${useId().replace(/:/g, '')}`

  return (
    <div className={`nivasa-language-switcher ${iconOnly ? 'icon-only' : ''} ${className}`.trim()}>
      {iconOnly && <svg className="nivasa-language-switcher-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18m0-18a14 14 0 0 0 0 18"/></svg>}
      <label htmlFor={selectId} className="sr-only" style={{ display: 'none' }}>
        Select Language
      </label>
      <select
        id={selectId}
        value={locale}
        onChange={(e) => setLocale(e.target.value as SupportedLocale)}
        aria-label="Language selection"
        style={{
          padding: '4px 8px',
          borderRadius: '6px',
          border: '1px solid var(--border, #e2e8f0)',
          background: 'var(--bg-surface, #ffffff)',
          color: 'var(--text-main, #1e293b)',
          fontSize: '13px',
          cursor: 'pointer',
        }}
      >
        {locales.map((loc) => (
          <option key={loc.code} value={loc.code}>
            {showNativeName ? `${loc.nativeName} (${loc.name})` : loc.name}
          </option>
        ))}
      </select>
    </div>
  )
}

