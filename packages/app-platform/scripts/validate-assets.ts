import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

export function runAssetValidation(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  const brandDir = path.join(rootDir, 'config/brands')
  if (!fs.existsSync(brandDir)) {
    return { valid: false, errors: [`Brand config directory missing: ${brandDir}`] }
  }

  const brandFiles = fs.readdirSync(brandDir).filter((f) => f.endsWith('.json'))
  if (brandFiles.length === 0) {
    errors.push('No brand configurations found in config/brands')
  }

  for (const bf of brandFiles) {
    const brand = JSON.parse(fs.readFileSync(path.join(brandDir, bf), 'utf-8'))
    const brandId = brand.brandId

    // Verify assets in packages/app-platform/assets/brands/[brandId]
    const brandAssetDir = path.join(rootDir, 'assets/brands', brandId)
    if (!fs.existsSync(brandAssetDir)) {
      errors.push(`Brand assets directory missing for ${brandId}: ${brandAssetDir}`)
      continue
    }

    const requiredAssets = ['logo.svg', 'logo-dark.svg', 'favicon.ico']
    for (const asset of requiredAssets) {
      const assetPath = path.join(brandAssetDir, asset)
      if (!fs.existsSync(assetPath)) {
        errors.push(`Missing required asset for brand "${brandId}": ${asset}`)
      } else {
        const stats = fs.statSync(assetPath)
        if (stats.size === 0) {
          errors.push(`Asset file is empty for brand "${brandId}": ${asset}`)
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isDirectRun) {
  const result = runAssetValidation()
  if (result.valid) {
    console.log('✓ Asset validation passed.')
    process.exit(0)
  } else {
    console.error('✗ Asset validation failed:')
    result.errors.forEach((e) => console.error(`  - ${e}`))
    process.exit(1)
  }
}

