import defaultBrandJson from '../config/brands/default.json' with { type: 'json' }
import type { BrandConfig, BrandAssets, BrandTheme } from './types'

export const defaultBrand: BrandConfig = defaultBrandJson as BrandConfig

const brandsRegistry: Record<string, BrandConfig> = {
  default: defaultBrand,
}

export function registerBrand(brand: BrandConfig) {
  brandsRegistry[brand.brandId] = brand
}

export function getBrand(brandId: string = 'default'): BrandConfig {
  return brandsRegistry[brandId] ?? defaultBrand
}

export function getBrandAssets(brandId: string = 'default'): BrandAssets {
  return getBrand(brandId).assets
}

export function getBrandTheme(brandId: string = 'default'): BrandTheme {
  return getBrand(brandId).theme
}

export function validateBrandConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Brand config must be a non-null object'] }
  }

  const c = config as Record<string, any>
  if (!c.brandId) errors.push('Missing brandId')

  if (!c.assets || typeof c.assets !== 'object') {
    errors.push('Missing or invalid assets object')
  } else {
    if (!c.assets.logo) errors.push('Missing assets.logo')
    if (!c.assets.logoDark) errors.push('Missing assets.logoDark')
    if (!c.assets.favicon) errors.push('Missing assets.favicon')
  }

  if (!c.theme || typeof c.theme !== 'object') {
    errors.push('Missing or invalid theme object')
  } else {
    if (!c.theme.primaryColor) errors.push('Missing theme.primaryColor')
    if (!c.theme.fontFamily) errors.push('Missing theme.fontFamily')
  }

  return { valid: errors.length === 0, errors }
}

