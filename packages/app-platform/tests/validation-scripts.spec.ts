import { describe, it, expect } from 'vitest'
import { runConfigValidation } from '../scripts/validate-config'
import { runTranslationValidation } from '../scripts/validate-translations'
import { runAssetValidation } from '../scripts/validate-assets'

describe('Validation Scripts', () => {
  it('validates repository configuration files', () => {
    const result = runConfigValidation()
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('validates repository translations parity across en and te', () => {
    const result = runTranslationValidation()
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('validates repository brand assets exist and are non-empty', () => {
    const result = runAssetValidation()
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })
})

