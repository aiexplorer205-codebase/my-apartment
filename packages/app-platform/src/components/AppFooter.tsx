import React from 'react'
import { getAppConfig, getFormattedCopyright } from '../config'

export interface AppFooterProps {
  className?: string
  showSupport?: boolean
}

export function AppFooter({
  className = '',
  showSupport = true,
}: AppFooterProps) {
  const config = getAppConfig()
  const copyright = getFormattedCopyright()

  return (
    <footer className={`nivasa-app-footer ${className}`.trim()} style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)', padding: '16px 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
        <span>{copyright}</span>
        {showSupport && (
          <div style={{ display: 'flex', gap: '12px' }}>
            {config.support.email && (
              <a href={`mailto:${config.support.email}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                {config.support.email}
              </a>
            )}
            {config.support.helpUrl && (
              <a href={config.support.helpUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                Help
              </a>
            )}
          </div>
        )}
      </div>
    </footer>
  )
}

