# Developer Guide: Shared Configuration, Localization, and Branding

This guide describes how to work with `@nivasa/app-platform`, the centralized package for configuration, localization (i18n), and branding shared between `admin-web` and `resident-web`.

---

## 1. Package Architecture

```
packages/app-platform/
  config/
    app-config.json              # Centralized application, company, copyright, support, and locale config
    locales.json                 # Single source of truth for supported locales and directions
    brands/
      default.json               # Brand assets and theme tokens
  locales/
    en/                          # English translations
      common.json                # Shared navigation, actions, status, messages
      admin.json                 # Admin-specific strings
      resident.json              # Resident-specific strings
      validation.json            # Shared validation messages
    te/                          # Telugu translations (exact key parity with en)
      common.json
      admin.json
      resident.json
      validation.json
  assets/
    brands/
      default/
        logo.svg                 # Primary brand mark
        logo-dark.svg            # Dark background variant
        favicon.ico              # Favicon
  src/
    config.ts                    # Typed config loader, copyright calculations, and schema validator
    locales.ts                   # Locales getter and direction helpers
    branding.ts                  # Brand assets & theme loader
    i18n/                        # i18next instance, resources bundle, server & client helpers
    components/                  # LanguageSwitcher, BrandLogo, AppFooter
    index.ts                     # Root barrel export
  scripts/
    validate-config.ts           # Build-time schema and syntax validator
    validate-translations.ts     # Translation parity & interpolation placeholder checker
    validate-assets.ts           # Asset existence and size validator
    validate-all.ts              # Composite validator
  tests/                         # Comprehensive Vitest unit test suite
```

---

## 2. Developer Workflows

### 2.1 Adding a New Locale (e.g. Hindi `hi`)

1. **Register the locale in `config/locales.json`**:
   ```json
   {
     "code": "hi",
     "name": "Hindi",
     "nativeName": "हिन्दी",
     "direction": "ltr"
   }
   ```
2. **Add the locale code to `config/app-config.json`**:
   Add `"hi"` to `localization.supportedLocales`.
3. **Create the translation files**:
   Create `packages/app-platform/locales/hi/` with:
   - `common.json`
   - `admin.json`
   - `resident.json`
   - `validation.json`
4. **Register the resource in `src/i18n/resources.ts`**:
   Import the JSON files and add `hi` to `resources`.
5. **Run validation**:
   ```bash
   pnpm run platform:validate
   ```

### 2.2 Adding a Shared Translation Key

1. Add the key to `packages/app-platform/locales/en/common.json` (or `validation.json`):
   ```json
   "actions": {
     "download": "Download"
   }
   ```
2. Add the corresponding translation to all supported locales (e.g. `te/common.json`):
   ```json
   "actions": {
     "download": "డౌన్‌లోడ్ చేయండి"
   }
   ```
3. Use the key in your React component:
   ```tsx
   import { useTranslation } from '@nivasa/app-platform'

   export function DownloadButton() {
     const { t } = useTranslation('common')
     return <button type="button">{t('actions.download')}</button>
   }
   ```

### 2.3 Adding an App-Specific Translation Key

1. If the key is for `admin-web`, add it to `locales/en/admin.json` and `locales/te/admin.json`.
2. If the key is for `resident-web`, add it to `locales/en/resident.json` and `locales/te/resident.json`.
3. Consume it with the namespace prefix:
   ```tsx
   const { t } = useTranslation(['common', 'admin'])
   const label = t('admin:overview.totalBilled')
   ```

### 2.4 Updating Company Details

Edit `packages/app-platform/config/app-config.json`:
```json
"company": {
  "name": "Your Company Name",
  "displayName": "Company",
  "website": "https://example.com"
}
```

### 2.5 Updating Copyright Information

In `packages/app-platform/config/app-config.json`:
```json
"copyright": {
  "owner": "Your Company Name",
  "startYear": 2024,
  "suffix": "All rights reserved."
}
```
The year range is dynamically resolved by `getCopyrightYearRange()` (e.g., `2024–2026`).

### 2.6 Changing Branding Assets and Theme Tokens

1. Update `packages/app-platform/config/brands/default.json` for paths and theme colors:
   ```json
   "theme": {
     "primaryColor": "#174c43",
     "fontFamily": "Inter, system-ui, sans-serif"
   }
   ```
2. Replace or add SVG/ICO files in `packages/app-platform/assets/brands/default/`.
3. Ensure public assets are synced to `apps/admin-web/public/brands/` and `apps/resident-web/public/brands/`.

### 2.7 Investigating Missing-Key Errors

- In development, missing keys log a warning: `[i18n] Missing translation key "..." in namespace "..." for language(s): ...`.
- Run the translation validation script to catch missing keys or placeholder mismatches:
  ```bash
  pnpm run i18n:validate
  ```
- Missing keys fall back to English (`en`) automatically and return the key name rather than an empty string.

---

## 3. Validation and CI Commands

| Command | Description |
|---|---|
| `pnpm run config:validate` | Validates JSON syntax, required fields, and URL/email schemas |
| `pnpm run i18n:validate` | Validates translation key parity and placeholder interpolation consistency |
| `pnpm run branding:validate` | Validates existence and non-zero size of brand assets |
| `pnpm run platform:validate` | Runs all 3 validations sequentially |
| `pnpm run typecheck` | Typechecks all packages including `@nivasa/app-platform` |
| `pnpm run lint` | Lints all packages with ESLint |
| `pnpm test` | Runs all Vitest unit tests |
| `pnpm run ci` | Runs full CI suite: validation + typecheck + lint + test + build |

