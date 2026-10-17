export interface AppConfig {
  application: {
    productName: string
    monogram: string
    adminName: string
    residentName: string
    description: string
  }
  company: {
    name: string
    displayName: string
    website: string
  }
  copyright: {
    owner: string
    startYear: number
    suffix: string
  }
  support: {
    email: string
    phone: string
    helpUrl: string
  }
  branding: {
    defaultBrand: string
  }
  localization: {
    defaultLocale: string
    supportedLocales: string[]
  }
}

export interface LocaleDefinition {
  code: string
  name: string
  nativeName: string
  direction: 'ltr' | 'rtl'
}

export interface LocalesConfig {
  defaultLocale: string
  locales: LocaleDefinition[]
}

export interface BrandAssets {
  logo: string
  logoDark: string
  favicon: string
  [key: string]: string
}

export interface BrandTheme {
  primaryColor: string
  fontFamily: string
  [key: string]: string
}

export interface BrandConfig {
  brandId: string
  assets: BrandAssets
  theme: BrandTheme
}

export type SupportedLocale = 'en' | 'te'

export type TranslationNamespace = 'common' | 'admin' | 'resident' | 'validation'

