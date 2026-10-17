import enCommon from '../../locales/en/common.json' with { type: 'json' }
import enAdmin from '../../locales/en/admin.json' with { type: 'json' }
import enResident from '../../locales/en/resident.json' with { type: 'json' }
import enValidation from '../../locales/en/validation.json' with { type: 'json' }

import teCommon from '../../locales/te/common.json' with { type: 'json' }
import teAdmin from '../../locales/te/admin.json' with { type: 'json' }
import teResident from '../../locales/te/resident.json' with { type: 'json' }
import teValidation from '../../locales/te/validation.json' with { type: 'json' }

export const resources = {
  en: {
    common: enCommon,
    admin: enAdmin,
    resident: enResident,
    validation: enValidation,
  },
  te: {
    common: teCommon,
    admin: teAdmin,
    resident: teResident,
    validation: teValidation,
  },
} as const

export type LocaleResources = typeof resources
export type Namespace = keyof typeof resources.en

