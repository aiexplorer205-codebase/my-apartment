'use client'
import type { ReactNode } from 'react'
import { useLocale, useTranslation } from '@block9/app-platform'

export function LoginPresentation({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useLocale()
  const { t } = useTranslation('common')
  return <main className="login-page login-resident">
    <section className="login-story">
      <header className="login-brand"><span className="login-monogram">M</span><div><strong>{t('loginReference.resident1')}</strong><span>{t('loginReference.resident2')}</span></div></header>
      <div className="login-story-body">
        
        <h1>{t('loginReference.resident3')}</h1><h2 lang="te">{t('loginReference.resident4')}</h2>
        <ul><li>{t('loginReference.resident5')}<small lang="te">{t('loginReference.resident6')}</small></li><li>{t('loginReference.resident7')}<small lang="te">{t('loginReference.resident8')}</small></li><li>{t('loginReference.resident9')}<small lang="te">{t('loginReference.resident10')}</small></li></ul>
      </div>
      <footer>{t('loginReference.resident11')}</footer>
    </section>
    <section className="login-panel">
      <div className="login-language" role="group" aria-label="Language"><button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>{t('loginReference.resident12')}</button><button type="button" lang="te" aria-pressed={locale === 'te'} onClick={() => setLocale('te')}>{t('loginReference.resident13')}</button></div>
      <div className="login-card">
        <p className="login-kicker">{t('loginReference.resident14')}</p>
        <h2>{t('loginReference.resident15')}</h2><h3 lang="te">{t('loginReference.resident16')}</h3>
        <p>{t('loginReference.resident17')}</p><p className="login-muted" lang="te">{t('loginReference.resident18')}</p>
        {children}
        <div className="login-help"><p>{t('loginReference.resident19')}</p><p lang="te">{t('loginReference.resident20')}</p><p>{t('loginReference.resident21')}</p><p lang="te">{t('loginReference.resident22')}</p></div>
      </div>
    </section>
  </main>
}
