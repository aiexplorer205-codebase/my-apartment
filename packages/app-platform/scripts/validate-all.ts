import { runConfigValidation } from './validate-config.ts'
import { runTranslationValidation } from './validate-translations.ts'
import { runAssetValidation } from './validate-assets.ts'

console.log('Running platform validations...\n')

let hasErrors = false

console.log('1. Validating application configuration and schemas...')
const configResult = runConfigValidation()
if (configResult.valid) {
  console.log('   ✓ Configuration and schema validation passed.')
} else {
  hasErrors = true
  console.error('   ✗ Configuration validation errors:')
  configResult.errors.forEach((e) => console.error(`     - ${e}`))
}

console.log('2. Validating translations and locale parity...')
const transResult = runTranslationValidation()
if (transResult.valid) {
  console.log('   ✓ Translation validation passed.')
} else {
  hasErrors = true
  console.error('   ✗ Translation validation errors:')
  transResult.errors.forEach((e) => console.error(`     - ${e}`))
}

console.log('3. Validating brand assets...')
const assetResult = runAssetValidation()
if (assetResult.valid) {
  console.log('   ✓ Asset validation passed.')
} else {
  hasErrors = true
  console.error('   ✗ Asset validation errors:')
  assetResult.errors.forEach((e) => console.error(`     - ${e}`))
}

if (hasErrors) {
  console.error('\n✗ Platform validation failed.')
  process.exit(1)
} else {
  console.log('\n✓ All platform validations passed successfully.')
  process.exit(0)
}
