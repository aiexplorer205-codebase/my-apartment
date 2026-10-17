'use client'

import React from 'react'
import { useLocale } from '../i18n/client'
import { getLocales } from '../locales'
import type { SupportedLocale } from '../types'

export interface LanguageSwitcherProps {
  className?: string
  showNativeName?: boolean
}

export function LanguageSwitcher({
  className = '',
  showNativeName = true,
}: LanguageSwitcherProps) {
  const { locale, setLocale } = useLocale()
  const locales = getLocales()

  return (
    <div className={`nivasa-language-switcher ${className}`.trim()}>
      <label htmlFor="nivasa-locale-select" className="sr-only" style={{ display: 'none' }}>
        Select Language
      </label>
      <select
        id="nivasa-locale-select"
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

