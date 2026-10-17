import { describe, it, expect } from 'vitest'
import {
  getAppConfig,
  getCopyrightYearRange,
  getFormattedCopyright,
  getSupportInfo,
  getApplicationInfo,
  validateAppConfig,
} from '../src/config'

describe('Application Configuration', () => {
  it('loads valid configuration object', () => {
    const config = getAppConfig()
    expect(config).toBeDefined()
    expect(config.application.productName).toBe('Nivasa')
    expect(config.application.monogram).toBe('N')
    expect(config.company.name).toBe('Nivasa Technologies Pvt. Ltd.')
    expect(config.copyright.owner).toBe('Nivasa Technologies Pvt. Ltd.')
    expect(config.support.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    expect(config.branding.defaultBrand).toBe('default')
    expect(config.localization.defaultLocale).toBe('en')
    expect(config.localization.supportedLocales).toContain('en')
    expect(config.localization.supportedLocales).toContain('te')
  })

  it('validates configuration and catches missing fields', () => {
    const result = validateAppConfig({})
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors).toContain('Missing application.productName')
    expect(result.errors).toContain('Missing application.monogram')
    expect(result.errors).toContain('Missing company.name')
  })

  it('validates invalid support email', () => {
    const validConfig = getAppConfig()
    const invalidConfig = {
      ...validConfig,
      support: { ...validConfig.support, email: 'not-an-email' },
    }
    const result = validateAppConfig(invalidConfig)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Invalid support.email format')
  })

  it('calculates copyright year ranges correctly', () => {
    expect(getCopyrightYearRange(2024)).toBe('2024')
    expect(getCopyrightYearRange(2026)).toBe('2024–2026')
    expect(getCopyrightYearRange(2023)).toBe('2024')

    const copyrightStr = getFormattedCopyright(2026)
    expect(copyrightStr).toContain('© 2024–2026 Nivasa Technologies Pvt. Ltd.')
  })

  it('provides support and application information', () => {
    const support = getSupportInfo()
    expect(support.email).toBe('support@nivasa.local')

    const app = getApplicationInfo()
    expect(app.productName).toBe('Nivasa')
    expect(app.adminName).toBe('Apartment Admin')
    expect(app.residentName).toBe('Resident')
  })
})

