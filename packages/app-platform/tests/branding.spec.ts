import { describe, it, expect } from 'vitest'
import {
  getBrand,
  getBrandAssets,
  getBrandTheme,
  validateBrandConfig,
  defaultBrand,
} from '../src/branding'

describe('Branding Configuration', () => {
  it('loads default brand configuration', () => {
    expect(defaultBrand).toBeDefined()
    expect(defaultBrand.brandId).toBe('default')
    expect(defaultBrand.assets.logo).toBe('/brands/default/logo.svg')
    expect(defaultBrand.assets.logoDark).toBe('/brands/default/logo-dark.svg')
    expect(defaultBrand.assets.favicon).toBe('/brands/default/favicon.ico')
    expect(defaultBrand.theme.primaryColor).toBe('#174c43')
  })

  it('retrieves brand, assets, and theme by id', () => {
    const brand = getBrand('default')
    expect(brand.brandId).toBe('default')

    const assets = getBrandAssets('default')
    expect(assets.logo).toBeDefined()

    const theme = getBrandTheme('default')
    expect(theme.primaryColor).toBe('#174c43')
  })

  it('falls back to default brand when unknown brand requested', () => {
    const brand = getBrand('non-existent-brand')
    expect(brand.brandId).toBe('default')
  })

  it('validates brand configuration and catches missing fields', () => {
    const valid = validateBrandConfig(defaultBrand)
    expect(valid.valid).toBe(true)

    const invalid = validateBrandConfig({
      brandId: 'incomplete',
      // missing name, assets, theme
    })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors).toContain('Missing or invalid assets object')
  })
})

