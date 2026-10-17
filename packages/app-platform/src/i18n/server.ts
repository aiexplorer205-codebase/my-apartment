import { createI18nInstance } from './instance'
import { defaultLocale, isLocaleSupported } from '../locales'
import type { SupportedLocale } from '../types'

export async function getServerTranslations(
  localeInput?: string | null,
  namespaces: string[] = ['common', 'validation']
) {
  const locale: SupportedLocale = localeInput && isLocaleSupported(localeInput)
    ? (localeInput as SupportedLocale)
    : defaultLocale

  const i18n = createI18nInstance(locale, namespaces)

  return {
    t: i18n.t.bind(i18n),
    i18n,
    locale,
  }
}

