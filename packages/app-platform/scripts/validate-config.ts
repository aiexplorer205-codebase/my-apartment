import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

export function runConfigValidation(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // 1. Check app-config.json
  const appConfigPath = path.join(rootDir, 'config/app-config.json')
  if (!fs.existsSync(appConfigPath)) {
    return { valid: false, errors: [`File not found: ${appConfigPath}`] }
  }

  let appConfig: any
  try {
    const raw = fs.readFileSync(appConfigPath, 'utf-8')
    appConfig = JSON.parse(raw)
  } catch (err) {
    return { valid: false, errors: [`app-config.json is not valid JSON: ${(err as Error).message}`] }
  }

  if (!appConfig.application?.productName) errors.push('Missing application.productName')
  if (!appConfig.application?.monogram) errors.push('Missing application.monogram')
  if (!appConfig.application?.adminName) errors.push('Missing application.adminName')
  if (!appConfig.application?.residentName) errors.push('Missing application.residentName')

  if (!appConfig.company?.name) errors.push('Missing company.name')
  if (!appConfig.company?.website) errors.push('Missing company.website')

  if (!appConfig.copyright?.owner) errors.push('Missing copyright.owner')
  if (typeof appConfig.copyright?.startYear !== 'number') errors.push('Missing or invalid copyright.startYear')

  if (!appConfig.support?.email) errors.push('Missing support.email')
  if (appConfig.support?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appConfig.support.email)) {
    errors.push(`Invalid support.email format: ${appConfig.support.email}`)
  }
  if (appConfig.support?.helpUrl && !/^https?:\/\//.test(appConfig.support.helpUrl)) {
    errors.push(`Invalid support.helpUrl format: ${appConfig.support.helpUrl}`)
  }

  // 2. Check locales.json
  const localesPath = path.join(rootDir, 'config/locales.json')
  if (!fs.existsSync(localesPath)) {
    errors.push(`File not found: ${localesPath}`)
  } else {
    try {
      const localesConfig = JSON.parse(fs.readFileSync(localesPath, 'utf-8'))
      if (!localesConfig.defaultLocale) errors.push('Missing defaultLocale in locales.json')
      if (!Array.isArray(localesConfig.locales) || localesConfig.locales.length === 0) {
        errors.push('locales array is empty or missing in locales.json')
      } else {
        const codes = new Set<string>()
        for (const loc of localesConfig.locales) {
          if (!loc.code) errors.push('Locale entry missing code')
          if (!loc.name) errors.push(`Locale ${loc.code} missing name`)
          if (!loc.nativeName) errors.push(`Locale ${loc.code} missing nativeName`)
          if (loc.direction !== 'ltr' && loc.direction !== 'rtl') {
            errors.push(`Locale ${loc.code} has invalid direction: ${loc.direction}`)
          }
          if (codes.has(loc.code)) errors.push(`Duplicate locale code: ${loc.code}`)
          codes.add(loc.code)
        }
        if (localesConfig.defaultLocale && !codes.has(localesConfig.defaultLocale)) {
          errors.push(`defaultLocale "${localesConfig.defaultLocale}" not in locales list`)
        }
      }
    } catch (err) {
      errors.push(`locales.json is not valid JSON: ${(err as Error).message}`)
    }
  }

  // 3. Check brands/default.json
  const defaultBrandPath = path.join(rootDir, 'config/brands/default.json')
  if (!fs.existsSync(defaultBrandPath)) {
    errors.push(`File not found: ${defaultBrandPath}`)
  } else {
    try {
      const brand = JSON.parse(fs.readFileSync(defaultBrandPath, 'utf-8'))
      if (!brand.brandId) errors.push('Brand missing brandId')
      if (!brand.assets?.logo) errors.push('Brand missing assets.logo')
      if (!brand.assets?.logoDark) errors.push('Brand missing assets.logoDark')
      if (!brand.assets?.favicon) errors.push('Brand missing assets.favicon')
      if (!brand.theme?.primaryColor) errors.push('Brand missing theme.primaryColor')
      if (!brand.theme?.fontFamily) errors.push('Brand missing theme.fontFamily')
    } catch (err) {
      errors.push(`brands/default.json is not valid JSON: ${(err as Error).message}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isDirectRun) {
  const result = runConfigValidation()
  if (result.valid) {
    console.log('✓ Configuration validation passed.')
    process.exit(0)
  } else {
    console.error('✗ Configuration validation failed:')
    result.errors.forEach((e) => console.error(`  - ${e}`))
    process.exit(1)
  }
}

