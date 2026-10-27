import { describe, it, expect } from 'vitest'
import { createI18nInstance } from '../src/i18n/instance'
import { getServerTranslations } from '../src/i18n/server'
import { resources } from '../src/i18n/resources'

describe('i18n Localization', () => {
  it('bundles both en and te resources with all 4 namespaces', () => {
    expect(resources.en).toBeDefined()
    expect(resources.te).toBeDefined()

    expect(resources.en.common).toBeDefined()
    expect(resources.en.admin).toBeDefined()
    expect(resources.en.resident).toBeDefined()
    expect(resources.en.validation).toBeDefined()

    expect(resources.te.common).toBeDefined()
    expect(resources.te.admin).toBeDefined()
    expect(resources.te.resident).toBeDefined()
    expect(resources.te.validation).toBeDefined()
  })

  it('translates shared keys in English', () => {
    const i18n = createI18nInstance('en', ['common', 'validation'])
    expect(i18n.t('actions.save', { ns: 'common' })).toBe('Save')
    expect(i18n.t('actions.cancel', { ns: 'common' })).toBe('Cancel')
    expect(i18n.t('navigation.overview', { ns: 'common' })).toBe('Dashboard')
    expect(i18n.t('status.loading', { ns: 'common' })).toBe('Loading...')
  })

  it('translates shared keys in Telugu with proper Unicode', () => {
    const i18n = createI18nInstance('te', ['common', 'validation'])
    expect(i18n.t('actions.save', { ns: 'common' })).toBe('భద్రపరచు')
    expect(i18n.t('actions.cancel', { ns: 'common' })).toBe('రద్దు చేయి')
    expect(i18n.t('navigation.overview', { ns: 'common' })).toBe('డ్యాష్‌బోర్డ్')
    expect(i18n.t('status.loading', { ns: 'common' })).toBe('లోడ్ అవుతోంది...')
  })

  it('interpolates variables correctly in en and te', () => {
    const i18nEn = createI18nInstance('en', ['common'])
    expect(i18nEn.t('messages.welcome', { ns: 'common', productName: 'MyApartment' })).toBe('Welcome to MyApartment')

    const i18nTe = createI18nInstance('te', ['common'])
    expect(i18nTe.t('messages.welcome', { ns: 'common', productName: 'నివాస' })).toBe('నివాస కి స్వాగతం')
  })

  it('handles pluralization correctly with count', () => {
    const i18nEn = createI18nInstance('en', ['admin', 'validation'])
    expect(i18nEn.t('stats.residentCount', { ns: 'admin', count: 1 })).toBe('1 resident')
    expect(i18nEn.t('stats.residentCount', { ns: 'admin', count: 5 })).toBe('5 residents')
    expect(i18nEn.t('minLength', { ns: 'validation', count: 1 })).toBe('Must be at least 1 character')
    expect(i18nEn.t('minLength', { ns: 'validation', count: 8 })).toBe('Must be at least 8 characters')

    const i18nTe = createI18nInstance('te', ['admin', 'validation'])
    expect(i18nTe.t('stats.residentCount', { ns: 'admin', count: 1 })).toBe('1 నివాసి')
    expect(i18nTe.t('stats.residentCount', { ns: 'admin', count: 5 })).toBe('5 నివాసితులు')
  })

  it('falls back to English when a key is missing in Telugu', () => {
    const instance = createI18nInstance('te', ['common'])
    // Add a fake resource key only in English
    instance.addResource('en', 'common', 'onlyInEnglish', 'Only in English')
    expect(instance.t('onlyInEnglish', { ns: 'common' })).toBe('Only in English')
  })

  it('does not return empty string for missing keys and returns key identifier', () => {
    const instance = createI18nInstance('en', ['common'])
    const missing = instance.t('non.existent.key', { ns: 'common' })
    expect(missing).toBe('non.existent.key')
    expect(missing).not.toBe('')
  })

  it('works in server rendering helper with isolated instances', async () => {
    const { t: tEn, locale: locEn } = await getServerTranslations('en', ['common', 'admin'])
    expect(locEn).toBe('en')
    expect(tEn('actions.save', { ns: 'common' })).toBe('Save')

    const { t: tTe, locale: locTe } = await getServerTranslations('te', ['common', 'admin'])
    expect(locTe).toBe('te')
    expect(tTe('actions.save', { ns: 'common' })).toBe('భద్రపరచు')
  })
})
