# Recommended localization and static-content architecture

For your Next.js Admin and Resident apps, I recommend a shared, JSON-driven localization package with build-time validation, locale-specific content files, centralized branding configuration, and a deterministic fallback chain.

This gives developers a simple workflow: update JSON, validate it in CI, build the apps, and deploy. Both apps share translation keys and common content without duplicating translations or tying the architecture to a content management system.

## 1. Architecture overview

JSON source files

Translations · Branding · Static content · Locale configuration

CI validation and build-time generation

Admin app

Admin UI + shared translations

Resident app

Resident UI + shared translations

Both consume the same versioned localization package

Localized, statically built application

English default · Indian languages · shared branding · fallback translations

### Recommended technology choices

| Concern | Recommendation |
| --- | --- |
| Framework | Next.js App Router |
| Translation source | JSON files in Git |
| Translation library | `next-intl` |
| Shared keys | Workspace package, e.g. `@company/i18n` |
| Static generation | Build-time JSON imports and statically rendered locale routes where appropriate |
| Language routing | `/en/...`, `/te/...`, `/hi/...` |
| Branding | Separate company/brand configuration JSON |
| Validation | TypeScript, JSON Schema or Zod, and CI checks |
| Missing translations | Explicit fallback to English |
| Updates | Pull request → validation → build → deployment |

Key decision: Keep translations and brand configuration separate. Language describes what the user reads; branding describes whose application the user sees. This lets you change a company name, logo, or copyright independently of translation strings.

## 2. Repository and folder structure

If Admin and Resident are maintained in the same repository, use a monorepo with one shared localization package.

text
```
repo/
├── apps/
│   ├── admin/
│   │   └── src/app/[locale]/
│   │       ├── layout.tsx
│   │       └── page.tsx
│   └── resident/
│       └── src/app/[locale]/
│           ├── layout.tsx
│           └── page.tsx
│
├── packages/
│   └── i18n/
│       ├── src/
│       │   ├── locales.ts
│       │   ├── messages.ts
│       │   ├── translate.ts
│       │   └── branding.ts
│       ├── messages/
│       │   ├── en/
│       │   │   ├── common.json
│       │   │   ├── validation.json
│       │   │   ├── admin.json
│       │   │   └── resident.json
│       │   ├── te/
│       │   │   ├── common.json
│       │   │   ├── validation.json
│       │   │   ├── admin.json
│       │   │   └── resident.json
│       │   └── hi/
│       │       ├── common.json
│       │       ├── validation.json
│       │       ├── admin.json
│       │       └── resident.json
│       ├── config/
│       │   ├── locales.json
│       │   └── brands/
│       │       └── default.json
│       └── scripts/
│           └── validate-messages.ts
│
└── package.json
```

This structure separates translations by locale and namespace, rather than maintaining one huge JSON file per language.

- `common.json`: shared buttons, navigation, labels and generic messages.
- `validation.json`: shared field errors and validation messages.
- `admin.json`: administrator-specific content.
- `resident.json`: resident-specific content.
- `config/brands/`: company names, copyright, logos, theme assets and other brand settings.

If the two apps live in separate repositories, publish `packages/i18n` as a private versioned npm package. Both applications should consume the same package version to keep their translation keys synchronized.

## 3. Translation JSON design

Use stable, semantic keys that are independent of the English wording. Keep shared keys in the shared namespace, and let both applications consume them.

Example `messages/en/common.json`:

json
```
{
  "app": {
    "name": "Community Portal"
  },
  "actions": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "edit": "Edit",
    "search": "Search",
    "back": "Back"
  },
  "status": {
    "loading": "Loading...",
    "success": "Operation completed successfully",
    "error": "Something went wrong"
  },
  "pagination": {
    "showing": "Showing {start} to {end} of {total} items"
  }
}
```

Example `messages/te/common.json`:

json
```
{
  "app": {
    "name": "కమ్యూనిటీ పోర్టల్"
  },
  "actions": {
    "save": "సేవ్ చేయండి",
    "cancel": "రద్దు చేయండి",
    "delete": "తొలగించండి",
    "edit": "సవరించండి",
    "search": "శోధించండి",
    "back": "వెనుకకు"
  },
  "status": {
    "loading": "లోడ్ అవుతోంది...",
    "success": "విజయవంతంగా పూర్తయింది",
    "error": "ఏదో తప్పు జరిగింది"
  },
  "pagination": {
    "showing": "{total} అంశాలలో {start} నుండి {end} వరకు చూపిస్తోంది"
  }
}
```

The Telugu values are illustrative and should be reviewed by a fluent Telugu speaker before production.

### Rules for translation keys

- Use the same key structure across every locale.
- Never use translated text as a key.
- Do not create separate `save` keys for Admin and Resident if the meaning is identical.
- Separate identical-looking words when their meanings differ by context.
- Use placeholders for dynamic values, not string concatenation.
- Keep interpolation parameters consistent across locales.

For example, `actions.save` should be shared by both apps. However, `admin.users.suspend` and `resident.account.deactivate` should remain separate if their actions and meanings differ.

## 4. Shared keys without mixing app-specific content

Use namespaces to control which content each application imports.

| Namespace | Admin | Resident |
| --- | --- | --- |
| `common` | Yes | Yes |
| `validation` | Yes | Yes |
| `admin` | Yes | No |
| `resident` | No | Yes |

This prevents the Resident app from unnecessarily shipping Admin-specific content.

With `next-intl`, you can use namespaced messages:

tsx
```
const t = useTranslations("common.actions");

return (
  <button onClick={handleSave}>
    {t("save")}
  </button>
);
```

For Admin-specific content:

tsx
```
const t = useTranslations("admin.users");

return <h1>{t("title")}</h1>;
```

The same `common.actions.save` key works in both apps, while the Admin namespace stays separate. `next-intl` supports nested message objects and is designed for Next.js routing, formatting and rendering.

Internationalization (i18n) for Next.js

+1

## 5. Locale configuration for Indian languages

Start with English and add languages based on your rollout plan. Use standard BCP 47-compatible locale identifiers consistently across URLs, JSON directories and formatting.

Example `config/locales.json`:

json
```
{
  "defaultLocale": "en",
  "supportedLocales": [
    "en",
    "hi",
    "te",
    "ta",
    "kn",
    "ml",
    "mr",
    "bn",
    "gu",
    "pa",
    "or",
    "as",
    "ur"
  ],
  "localeNames": {
    "en": "English",
    "hi": "हिन्दी",
    "te": "తెలుగు",
    "ta": "தமிழ்",
    "kn": "ಕನ್ನಡ",
    "ml": "മലയാളം",
    "mr": "मराठी",
    "bn": "বাংলা",
    "gu": "ગુજરાતી",
    "pa": "ਪੰਜਾਬੀ",
    "or": "ଓଡ଼ିଆ",
    "as": "অসমীয়া",
    "ur": "اردو"
  }
}
```

This is a proposed language catalog, not a requirement to translate every language immediately. Prioritize the languages your residents actually use.

Recommended locale conventions:

- Use `en` as the canonical English locale unless you need region-specific differences.
- Use `hi`, `te`, `ta`, and similar language codes for the other Indian languages.
- Introduce region-specific variants such as `en-IN` only when regional formatting or content differences warrant them.
- For Urdu, plan for right-to-left layout support. Do not assume all Indian-language interfaces are left-to-right.

For dates, numbers and currency, use `Intl.DateTimeFormat` and `Intl.NumberFormat` with an explicit locale and an appropriate time zone. Translation alone is not localization.

## 6. Fallback translation strategy

I recommend a two-level fallback policy: resolve missing keys using English, but fail the build when required translations are missing.

1. Requested locale

Example: Telugu (`te`)

If the key is missing

2. English (`en`)

Use the matching English key

If still missing

3. Missing-key handling

Log or report the key; show a safe placeholder in development

The runtime fallback improves resilience, but it should not become a substitute for complete translations.

### Build-time message resolution

A simple custom resolver can merge the requested locale over English before passing messages to the UI. This is useful if you prefer to keep your JSON files and namespaces as they are.

ts
```
// packages/i18n/src/messages.ts
import enCommon from "../messages/en/common.json";
import teCommon from "../messages/te/common.json";

const dictionaries = {
  en: enCommon,
  te: teCommon,
} as const;

type Locale = keyof typeof dictionaries;

function mergeMessages(
  fallback: Record<string, unknown>,
  localized: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...fallback };

  for (const [key, value] of Object.entries(localized)) {
    const base = fallback[key];

    result[key] =
      isObject(base) && isObject(value)
        ? mergeMessages(base, value)
        : value;
  }

  return result;
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function getMessages(locale: Locale) {
  return locale === "en"
    ? dictionaries.en
    : mergeMessages(
        dictionaries.en as Record<string, unknown>,
        dictionaries[locale] as Record<string, unknown>
      );
}
```

This illustrates the merging approach for two locales and one namespace. In production, generate the locale registry from your configured files and merge each namespace independently. A nested object is merged recursively; arrays and scalar values are replaced as complete values.

An alternative is to use `next-intl`'s built-in missing-message handling and configure English as the fallback locale. If you do this, verify the behavior for your installed version and your message-loading strategy; do not assume missing keys are automatically merged in every configuration.

### Fallback policy for production

- Missing translation: English fallback at runtime, with a development warning.
- Missing required key: CI validation failure.
- Unknown locale: Return a 404 or redirect to the default locale according to your routing policy.
- Missing branding asset: Use an explicitly configured default asset.
- Missing company name: Fail validation rather than silently displaying the wrong company's name.

This keeps the user experience resilient without allowing localization gaps to accumulate unnoticed.

## 7. Configurable company name, copyright and branding

Treat brand configuration as a separate JSON resource, independent of translation dictionaries.

Example `config/brands/default.json`:

json
```
{
  "brandId": "default",
  "company": {
    "name": "Example Technologies Pvt. Ltd.",
    "displayName": "Example",
    "website": "https://example.com"
  },
  "copyright": {
    "startYear": 2024,
    "owner": "Example Technologies Pvt. Ltd.",
    "format": "© {startYear}-{currentYear} {owner}. All rights reserved."
  },
  "assets": {
    "logo": "/brands/default/logo.svg",
    "logoDark": "/brands/default/logo-dark.svg",
    "favicon": "/brands/default/favicon.ico",
    "loginIllustration": "/brands/default/login.svg"
  },
  "theme": {
    "primaryColor": "#2457A7",
    "fontFamily": "Inter"
  }
}
```

These values are illustrative. Replace the example company details and assets with your actual branding.

Render the copyright dynamically:

tsx
```
type CopyrightConfig = {
  startYear: number;
  owner: string;
};

export function Copyright({
  config,
}: {
  config: CopyrightConfig;
}) {
  const currentYear = new Date().getFullYear();

  const yearRange =
    config.startYear >= currentYear
      ? `${currentYear}`
      : `${config.startYear}-${currentYear}`;

  return (
    <footer>
      © {yearRange} {config.owner}. All rights reserved.
    </footer>
  );
}
```

For build-time static rendering, decide how the current year is supplied. If the copyright is rendered into HTML at build time, it can become stale after New Year's Day. You can instead render the year on the client or rebuild annually. The right choice depends on whether you require fully static HTML.

### Branding design rules

- Store logos and illustrations in public, version-controlled assets.
- Reference them using stable public paths rather than hardcoding URLs in components.
- Keep branding configuration separate from locale content so the same brand can support all languages.
- If Admin and Resident have different branding, use separate brand configurations or explicit app-specific overrides.
- If you support multiple companies or tenants, select the brand configuration from a trusted server-side tenant mapping. Do not let arbitrary user input choose an unrestricted asset path or expose private configuration.
- Keep public branding separate from secrets. JSON shipped to the browser must be treated as public.

## 8. Next.js build-time integration

For the App Router, use a locale segment and pre-render supported locale routes using `generateStaticParams`. Next.js documents this approach for statically generating locale-specific pages.

Next.js

+1

Example `apps/resident/src/app/[locale]/layout.tsx`:

tsx
```
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@company/i18n/messages";
import { locales } from "@company/i18n/locales";

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;

  if (!locales.includes(locale as (typeof locales)[number])) {
    notFound();
  }

  const messages = getMessages(
    locale as (typeof locales)[number]
  );

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

This example assumes the package exports `locales` and `getMessages`, and that your messages are compatible with `next-intl`. The exact provider and message-loading setup should match your installed `next-intl` version.

For production, I recommend the following refinements:

- Generate the locale registry from one source of truth; don't maintain separate lists in each app.
- Load only the namespaces that an app needs.
- Prefer Server Components for pages that do not require client-side interactivity.
- Pass only the required messages to Client Components to avoid unnecessarily increasing the browser bundle.
- Test your deployment mode before enabling `dynamicParams = false`, particularly if you have routes that are not enumerated at build time.

If you want a fully static export, verify the deployment constraints before adopting any middleware or runtime-dependent routing. The Next.js internationalization guide distinguishes App Router locale segments from Pages Router internationalization and its routing constraints.

Next.js

+1

## 9. Build-time validation and CI pipeline

This is the most important control for a developer-managed JSON workflow.

1. Developer changes JSON

2. Validate schema and translation keys

3. Compare placeholders and detect missing keys

4. Build Admin and Resident

5. Deploy validated artifacts

Your validation script should check the following:

| Validation | Required behavior |
| --- | --- |
| JSON syntax | Reject invalid JSON |
| Key parity | Report missing and unexpected keys |
| Placeholder parity | Ensure `{count}` or `{name}` exists in every translation where required |
| Value types | Ensure translation leaves are strings or supported message formats |
| Branding schema | Validate required names, paths, colors and copyright fields |
| Locale registry | Ensure every supported locale has the required files |
| Fallback coverage | Ensure every required key exists in English |
| Unicode | Preserve non-Latin scripts correctly |
| Production build | Fail if validation fails |

A useful additional check is to detect unused translation keys, so deleted features do not leave obsolete strings behind.

Suggested commands:

json
```
{
  "scripts": {
    "i18n:validate": "tsx packages/i18n/scripts/validate-messages.ts",
    "build:admin": "npm run build --workspace=apps/admin",
    "build:resident": "npm run build --workspace=apps/resident",
    "build": "npm run i18n:validate && npm run build:admin && npm run build:resident"
  }
}
```

Adjust workspace names to match your actual package manager and repository layout.

## 10\. Static content beyond translations

Not all static content belongs in translation dictionaries. Separate content by purpose.

| Content type | Storage |
| --- | --- |
| Button labels, navigation, errors | Translation JSON |
| Company name, logo, copyright | Brand configuration JSON |
| Help articles, FAQ, onboarding instructions | Structured content JSON, localized by locale |
| Legal notices and policies | Versioned content JSON with review ownership |
| Images, logos, fonts | Static public assets |
| User names, property data, live notifications | API/database, not build-time JSON |

For example, an FAQ entry could use a stable content ID across languages:

json
```
{
  "faq": [
    {
      "id": "payment-methods",
      "title": "Which payment methods are supported?",
      "body": "Available payment methods are shown at checkout."
    }
  ]
}
```

The translated file should retain the same `id` while localizing the `title` and `body`.

Important: Build-time JSON is ideal for relatively stable content. Changes will not appear in an already-built deployment until you rebuild and deploy, unless you deliberately introduce a runtime content-delivery mechanism.

## 11\. Recommended implementation roadmap

1. Phase 1 — Foundation: Create the shared package, locale registry, English dictionaries, brand schema and translation-key conventions.
2. Phase 2 — Integration: Connect both Next.js apps, configure locale routing, add language selectors and integrate shared namespaces.
3. Phase 3 — Indian languages: Add your prioritized languages, review translations with native speakers, and test fonts, text expansion and RTL behavior where applicable.
4. Phase 4 — Quality gates: Add key parity, placeholder validation, missing-key reports and branding validation to CI.
5. Phase 5 — Release process: Version shared packages, build both apps from the same validated JSON revision, and document how developers add a language or update a brand.

## Final recommendation

Use `next-intl` \+ a shared `@company/i18n` package + version-controlled JSON + build-time validation. Keep shared messages, app-specific messages, brand configuration and static content in distinct namespaces or files.

The three architectural rules I would enforce are:

1. One source of truth for shared keys and supported locales.
2. English fallback at runtime, with missing required translations blocked in CI.
3. Branding and content changes go through the same reviewed build-and-deploy process, with no runtime CMS dependency.

This design supports a growing Indian-language catalog, keeps Admin and Resident consistent, and makes localization changes auditable and predictable.