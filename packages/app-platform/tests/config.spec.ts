import configuredBrand from '../config/app-config.json'
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
    expect(config.application.productName).toBe(configuredBrand.application.productName)
    expect(config.application.monogram).toBe(configuredBrand.application.monogram)
    expect(config.company.name).toBe(configuredBrand.company.name)
    expect(config.copyright.owner).toBe(configuredBrand.copyright.owner)
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
    const start = configuredBrand.copyright.startYear
    expect(getCopyrightYearRange(start)).toBe(String(start))
    expect(getCopyrightYearRange(start + 2)).toBe(`${start}–${start + 2}`)
    expect(getCopyrightYearRange(start - 1)).toBe(String(start))

    const copyrightStr = getFormattedCopyright(start + 2)
    expect(copyrightStr).toContain(`© ${start}–${start + 2} ${configuredBrand.copyright.owner}`)
  })

  it('provides support and application information', () => {
    const support = getSupportInfo()
    expect(support.email).toBe(configuredBrand.support.email)

    const app = getApplicationInfo()
    expect(app.productName).toBe(configuredBrand.application.productName)
    expect(app.adminName).toBe('Apartment Admin')
    expect(app.residentName).toBe('Resident')
  })
})

