import localesConfigJson from '../config/locales.json' with { type: 'json' }
import type { LocalesConfig, LocaleDefinition, SupportedLocale } from './types'

export const localesConfig: LocalesConfig = localesConfigJson as LocalesConfig

export const defaultLocale: SupportedLocale = localesConfig.defaultLocale as SupportedLocale

export const supportedLocales: SupportedLocale[] = localesConfig.locales.map((l) => l.code as SupportedLocale)

export function getLocales(): LocaleDefinition[] {
  return localesConfig.locales
}

export function getDefaultLocale(): SupportedLocale {
  return defaultLocale
}

export function getSupportedLocales(): SupportedLocale[] {
  return supportedLocales
}

export function isLocaleSupported(code: string): code is SupportedLocale {
  return supportedLocales.includes(code as SupportedLocale)
}

export function getLocaleDefinition(code: string): LocaleDefinition | undefined {
  return localesConfig.locales.find((l) => l.code === code)
}

export function getLocaleDirection(code: string): 'ltr' | 'rtl' {
  const def = getLocaleDefinition(code)
  return def?.direction ?? 'ltr'
}

export function validateLocalesConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Locales config must be a non-null object'] }
  }

  const c = config as Record<string, any>
  if (!c.defaultLocale) {
    errors.push('Missing defaultLocale')
  }

  if (!Array.isArray(c.locales) || c.locales.length === 0) {
    errors.push('Missing or empty locales array')
    return { valid: false, errors }
  }

  const codes = new Set<string>()
  for (const loc of c.locales) {
    if (!loc.code) errors.push('Locale entry missing code')
    if (!loc.name) errors.push(`Locale ${loc.code || 'unknown'} missing name`)
    if (!loc.nativeName) errors.push(`Locale ${loc.code || 'unknown'} missing nativeName`)
    if (loc.direction !== 'ltr' && loc.direction !== 'rtl') {
      errors.push(`Locale ${loc.code || 'unknown'} has invalid direction: ${loc.direction}`)
    }
    if (codes.has(loc.code)) {
      errors.push(`Duplicate locale code: ${loc.code}`)
    }
    codes.add(loc.code)
  }

  if (c.defaultLocale && !codes.has(c.defaultLocale)) {
    errors.push(`defaultLocale "${c.defaultLocale}" is not in the locales list`)
  }

  return { valid: errors.length === 0, errors }
}

