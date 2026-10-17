import appConfigJson from '../config/app-config.json' with { type: 'json' }
import type { AppConfig } from './types'

export const appConfig: AppConfig = appConfigJson as AppConfig

export function getAppConfig(): AppConfig {
  return appConfig
}

export function getCopyrightYearRange(currentYear: number = new Date().getFullYear()): string {
  const startYear = appConfig.copyright.startYear
  if (currentYear <= startYear) {
    return `${startYear}`
  }
  return `${startYear}–${currentYear}`
}

export function getFormattedCopyright(currentYear: number = new Date().getFullYear()): string {
  const yearRange = getCopyrightYearRange(currentYear)
  return `© ${yearRange} ${appConfig.copyright.owner}. ${appConfig.copyright.suffix}`
}

export function getSupportInfo() {
  return appConfig.support
}

export function getApplicationInfo() {
  return appConfig.application
}

export function validateAppConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration must be a non-null object'] }
  }

  const c = config as Record<string, any>

  if (!c.application?.productName) errors.push('Missing application.productName')
  if (!c.application?.monogram) errors.push('Missing application.monogram')
  if (!c.application?.adminName) errors.push('Missing application.adminName')
  if (!c.application?.residentName) errors.push('Missing application.residentName')

  if (!c.company?.name) errors.push('Missing company.name')
  if (!c.company?.website) errors.push('Missing company.website')

  if (!c.copyright?.owner) errors.push('Missing copyright.owner')
  if (typeof c.copyright?.startYear !== 'number') errors.push('Missing or invalid copyright.startYear')

  if (!c.support?.email) errors.push('Missing support.email')
  if (c.support?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.support.email)) {
    errors.push('Invalid support.email format')
  }

  if (!c.branding?.defaultBrand) errors.push('Missing branding.defaultBrand')

  if (!c.localization?.defaultLocale) errors.push('Missing localization.defaultLocale')
  if (!Array.isArray(c.localization?.supportedLocales) || c.localization.supportedLocales.length === 0) {
    errors.push('Missing or empty localization.supportedLocales')
  } else if (!c.localization.supportedLocales.includes(c.localization.defaultLocale)) {
    errors.push('localization.defaultLocale must be included in supportedLocales')
  }

  return { valid: errors.length === 0, errors }
}

