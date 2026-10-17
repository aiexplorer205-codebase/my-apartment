import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const REQUIRED_NAMESPACES = ['common', 'admin', 'resident', 'validation']

function extractPlaceholders(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g)
  if (!matches) return []
  return matches.map((m) => m.replace(/\{\{|\}\}/g, '').trim()).sort()
}

function getLeafNodes(obj: any, prefix = ''): Record<string, string> {
  const leaves: Record<string, string> = {}
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    const val = obj[key]
    if (typeof val === 'string') {
      leaves[fullKey] = val
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(leaves, getLeafNodes(val, fullKey))
    }
  }
  return leaves
}

export function runTranslationValidation(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  const localesConfigPath = path.join(rootDir, 'config/locales.json')
  if (!fs.existsSync(localesConfigPath)) {
    return { valid: false, errors: [`File not found: ${localesConfigPath}`] }
  }

  const localesConfig = JSON.parse(fs.readFileSync(localesConfigPath, 'utf-8'))
  const locales = localesConfig.locales.map((l: any) => l.code)

  for (const locale of locales) {
    const localeDir = path.join(rootDir, 'locales', locale)
    if (!fs.existsSync(localeDir)) {
      errors.push(`Locale directory missing: ${localeDir}`)
      continue
    }

    for (const ns of REQUIRED_NAMESPACES) {
      const nsFile = path.join(localeDir, `${ns}.json`)
      if (!fs.existsSync(nsFile)) {
        errors.push(`Missing namespace file: ${locale}/${ns}.json`)
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  // Compare each locale against English
  for (const ns of REQUIRED_NAMESPACES) {
    const enFile = path.join(rootDir, 'locales/en', `${ns}.json`)
    let enObj: any
    try {
      enObj = JSON.parse(fs.readFileSync(enFile, 'utf-8'))
    } catch (e) {
      errors.push(`en/${ns}.json is invalid JSON: ${(e as Error).message}`)
      continue
    }

    const enLeaves = getLeafNodes(enObj)
    const enKeys = Object.keys(enLeaves)

    for (const locale of locales) {
      if (locale === 'en') {
        for (const [key, val] of Object.entries(enLeaves)) {
          if (!val.trim()) {
            errors.push(`Empty translation in en/${ns}.json for key: ${key}`)
          }
        }
        continue
      }

      const locFile = path.join(rootDir, 'locales', locale, `${ns}.json`)
      let locObj: any
      try {
        locObj = JSON.parse(fs.readFileSync(locFile, 'utf-8'))
      } catch (e) {
        errors.push(`${locale}/${ns}.json is invalid JSON: ${(e as Error).message}`)
        continue
      }

      const locLeaves = getLeafNodes(locObj)
      const locKeys = new Set(Object.keys(locLeaves))

      // Check missing keys
      for (const enKey of enKeys) {
        if (!locKeys.has(enKey)) {
          errors.push(`Missing translation in ${locale}/${ns}.json for key: ${enKey}`)
        } else {
          const locVal = locLeaves[enKey]
          if (!locVal || !locVal.trim()) {
            errors.push(`Empty translation in ${locale}/${ns}.json for key: ${enKey}`)
          } else {
            // Check placeholders
            const enPlaceholders = extractPlaceholders(enLeaves[enKey])
            const locPlaceholders = extractPlaceholders(locVal)
            if (enPlaceholders.join(',') !== locPlaceholders.join(',')) {
              errors.push(
                `Placeholder mismatch in ${locale}/${ns}.json for key "${enKey}": expected [${enPlaceholders.join(', ')}], got [${locPlaceholders.join(', ')}]`
              )
            }
          }
        }
      }

      // Check unexpected extra keys
      for (const locKey of Object.keys(locLeaves)) {
        if (!(locKey in enLeaves)) {
          errors.push(`Unexpected extra key in ${locale}/${ns}.json: ${locKey}`)
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isDirectRun) {
  const result = runTranslationValidation()
  if (result.valid) {
    console.log('✓ Translation validation passed.')
    process.exit(0)
  } else {
    console.error('✗ Translation validation failed:')
    result.errors.forEach((e) => console.error(`  - ${e}`))
    process.exit(1)
  }
}

