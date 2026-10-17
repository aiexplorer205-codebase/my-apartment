import { describe, it, expect } from 'vitest'
import {
  getLocales,
  getDefaultLocale,
  getSupportedLocales,
  isLocaleSupported,
  getLocaleDefinition,
  getLocaleDirection,
  validateLocalesConfig,
} from '../src/locales'

describe('Locale Configuration', () => {
  it('resolves default locale correctly', () => {
    expect(getDefaultLocale()).toBe('en')
  })

  it('lists supported locales including English and Telugu', () => {
    const supported = getSupportedLocales()
    expect(supported).toContain('en')
    expect(supported).toContain('te')
  })

  it('correctly checks whether a locale is supported', () => {
    expect(isLocaleSupported('en')).toBe(true)
    expect(isLocaleSupported('te')).toBe(true)
    expect(isLocaleSupported('fr')).toBe(false)
    expect(isLocaleSupported('')).toBe(false)
  })

  it('returns locale definitions with native names and direction', () => {
    const en = getLocaleDefinition('en')
    expect(en).toBeDefined()
    expect(en?.name).toBe('English')
    expect(en?.direction).toBe('ltr')

    const te = getLocaleDefinition('te')
    expect(te).toBeDefined()
    expect(te?.name).toBe('Telugu')
    expect(te?.nativeName).toBe('తెలుగు')
    expect(te?.direction).toBe('ltr')
  })

  it('returns direction for rtl and ltr locales', () => {
    expect(getLocaleDirection('en')).toBe('ltr')
    expect(getLocaleDirection('te')).toBe('ltr')
  })

  it('validates locales configuration correctly', () => {
    const valid = validateLocalesConfig({
      defaultLocale: 'en',
      locales: [
        { code: 'en', name: 'English', nativeName: 'English', direction: 'ltr' },
        { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', direction: 'ltr' },
      ],
    })
    expect(valid.valid).toBe(true)

    const invalid = validateLocalesConfig({
      defaultLocale: 'fr',
      locales: [{ code: 'en', name: 'English', nativeName: 'English', direction: 'ltr' }],
    })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors).toContain('defaultLocale "fr" is not in the locales list')
  })
})

