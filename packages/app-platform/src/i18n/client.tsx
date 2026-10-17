'use client'

import React, { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import type { i18n } from 'i18next'
import { createI18nInstance } from './instance'
import { defaultLocale, isLocaleSupported, getLocaleDirection } from '../locales'
import type { SupportedLocale } from '../types'

export const LOCALE_COOKIE_NAME = 'nivasa_locale'

function getCookieLocale(): SupportedLocale | null {
  if (typeof document === 'undefined') return null
  const cookies = document.cookie.split(';')
  for (const c of cookies) {
    const [name, val] = c.trim().split('=')
    if (name === LOCALE_COOKIE_NAME && val && isLocaleSupported(val)) {
      return val as SupportedLocale
    }
  }
  return null
}

function setCookieLocale(locale: SupportedLocale) {
  if (typeof document === 'undefined') return
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=31536000; SameSite=Lax`
}

interface LocaleContextValue {
  locale: SupportedLocale
  setLocale: (locale: SupportedLocale) => void
  direction: 'ltr' | 'rtl'
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  setLocale: () => {},
  direction: 'ltr',
})

export interface I18nProviderProps {
  children: ReactNode
  initialLocale?: string
  namespaces?: string[]
}

export function I18nProvider({
  children,
  initialLocale,
  namespaces = ['common', 'admin', 'resident', 'validation'],
}: I18nProviderProps) {
  const resolvedInitialLocale: SupportedLocale = initialLocale && isLocaleSupported(initialLocale)
    ? (initialLocale as SupportedLocale)
    : defaultLocale

  const [locale, setLocaleState] = useState<SupportedLocale>(resolvedInitialLocale)

  const i18nInstance: i18n = useMemo(() => {
    return createI18nInstance(locale, namespaces)
  }, []) // stable instance on client

  useEffect(() => {
    // Check if a cookie exists on client hydration
    const cookieLocale = getCookieLocale()
    if (cookieLocale && cookieLocale !== locale) {
      setLocaleState(cookieLocale)
      i18nInstance.changeLanguage(cookieLocale)
      document.documentElement.lang = cookieLocale
      document.documentElement.dir = getLocaleDirection(cookieLocale)
    } else {
      document.documentElement.lang = locale
      document.documentElement.dir = getLocaleDirection(locale)
    }
  }, [i18nInstance])

  const setLocale = (newLocale: SupportedLocale) => {
    if (!isLocaleSupported(newLocale)) return
    setLocaleState(newLocale)
    setCookieLocale(newLocale)
    i18nInstance.changeLanguage(newLocale)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = newLocale
      document.documentElement.dir = getLocaleDirection(newLocale)
    }
  }

  const contextValue = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    direction: getLocaleDirection(locale),
  }), [locale])

  return (
    <LocaleContext.Provider value={contextValue}>
      <I18nextProvider i18n={i18nInstance}>
        {children}
      </I18nextProvider>
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}

export { useTranslation } from 'react-i18next'
