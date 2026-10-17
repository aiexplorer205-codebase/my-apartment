import i18next, { type i18n, type InitOptions } from 'i18next'
import { resources } from './resources'
import { defaultLocale, supportedLocales } from '../locales'

export function getBaseI18nOptions(locale: string = defaultLocale, namespaces: string[] = ['common', 'validation']): InitOptions {
  return {
    lng: locale,
    fallbackLng: defaultLocale,
    supportedLngs: supportedLocales,
    ns: namespaces,
    defaultNS: 'common',
    resources,
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: false,
    },
    missingKeyHandler: (lngs, ns, key) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[i18n] Missing translation key "${key}" in namespace "${ns}" for language(s): ${Array.isArray(lngs) ? lngs.join(', ') : lngs}`)
      }
    },
    parseMissingKeyHandler: (key) => {
      return key
    },
  }
}

export function createI18nInstance(locale: string = defaultLocale, namespaces: string[] = ['common', 'validation']): i18n {
  const instance = i18next.createInstance()
  instance.init(getBaseI18nOptions(locale, namespaces))
  return instance
}

