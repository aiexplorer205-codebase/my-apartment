'use client'
import type { ReactNode } from 'react'
import { useLocale, useTranslation } from '@block9/app-platform'

export function LoginPresentation({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useLocale()
  const { t } = useTranslation('common')
  return <main className="login-page login-admin">
    <section className="login-story">
      <header className="login-brand"><span className="login-monogram">M</span><div><strong>{t('loginReference.admin1')}</strong><span>{t('loginReference.admin2')}</span></div></header>
      <div className="login-story-body">
        <p className="login-kicker">{t('loginReference.admin3')}</p>
        <h1>{t('loginReference.admin4')}</h1><h2 lang="te">{t('loginReference.admin5')}</h2>
        <p>{t('loginReference.admin6')}</p><p lang="te">{t('loginReference.admin7')}</p>
      </div>
      <footer>{t('loginReference.admin8')}</footer>
    </section>
    <section className="login-panel">
      <div className="login-language" role="group" aria-label="Language"><button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>{t('loginReference.admin9')}</button><button type="button" lang="te" aria-pressed={locale === 'te'} onClick={() => setLocale('te')}>{t('loginReference.admin10')}</button></div>
      <div className="login-card">
        
        <h2>{t('loginReference.admin11')}</h2><h3 lang="te">{t('loginReference.admin12')}</h3>
        
        {children}
        
      </div>
    </section>
  </main>
}
