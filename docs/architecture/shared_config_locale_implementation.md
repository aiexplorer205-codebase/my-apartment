Shared Configuration, Localization, and Branding
1. Purpose

Implement a centralized, reusable application platform for the Admin and Resident Next.js applications.

The platform must provide:

Centralized application configuration.
Shared localization using i18next and react-i18next.
Separate, configurable branding assets.
English and Indian-language support.
Shared translation keys across applications.
English fallback translations.
Build-time JSON loading and validation.
Automated testing and CI enforcement.
Developers manage configuration, translations, and assets through version-controlled files. Changes must be validated and deployed through the existing build-and-release pipeline.

Primary constraint: Do not introduce a runtime CMS, translation API, or database dependency for static configuration and translations.

2. Mandatory instructions for the coding agent

Before implementing changes:

Inspect the repository structure, package.json files, workspace configuration, Next.js versions, TypeScript configuration, and existing application conventions.
Identify the Admin and Resident applications and determine whether they share a repository or are maintained separately.
Inspect existing localization, routing, configuration, theming, asset management, testing, and CI implementations.
Reuse existing conventions and dependencies wherever practical.
Prepare an implementation plan based on the actual repository.
Implement incrementally and run the available tests, linting, type checking, and production builds.
Report completed changes, commands executed, test results, and any remaining limitations.
Do not replace working application architecture merely to match the example structure in this document.

Do not invent application names, company details, support contacts, production URLs, or brand assets. Preserve existing values or introduce clearly identified placeholders in development examples.

Do not overwrite existing user changes or remove existing functionality.

3. Target architecture

Create a shared package for configuration, localization, and branding.

For a monorepo, prefer the existing workspace conventions. If no workspace exists and both applications share a repository, use the repository's established package manager to introduce a shared package.

Suggested logical structure:


packages/
  app-platform/
    config/
      app-config.json
      locales.json
      brands/
        default.json
    locales/
      en/
        common.json
        admin.json
        resident.json
        validation.json
      te/
        common.json
        admin.json
        resident.json
        validation.json
      hi/
        common.json
        admin.json
        resident.json
        validation.json
    assets/
      brands/
        default/
          logo.svg
          logo-dark.svg
          favicon.ico
    src/
      config.ts
      locales.ts
      branding.ts
      i18n/
        instance.ts
        resources.ts
        server.ts
        client.ts
      index.ts
    scripts/
      validate-config.ts
      validate-translations.ts
      validate-assets.ts
    tests/
This is a logical reference structure, not a requirement to relocate existing files unnecessarily.

Keep public assets in locations served by Next.js. If assets are stored in a workspace package, ensure the existing build and deployment configuration correctly exposes them. Do not assume files inside a package are automatically available under a public URL.

If the applications use separate repositories, implement the shared package as a private, versioned package and document how both applications consume compatible versions.

4. Centralized application configuration

4.1 Configuration responsibilities

Create or extend app-config.json to manage:

Product name.
Application-specific display names.
Company name and display name.
Company website.
Copyright owner and starting year.
Support email, phone, and help URL.
Default brand identifier.
Branding asset references.
Default locale and supported locales.
Other genuinely static, non-sensitive application settings.
Example:


{
  "application": {
    "productName": "Community Portal",
    "adminName": "Community Admin",
    "residentName": "Resident Portal"
  },
  "company": {
    "name": "Example Technologies Pvt. Ltd.",
    "displayName": "Example",
    "website": "https://example.com"
  },
  "copyright": {
    "owner": "Example Technologies Pvt. Ltd.",
    "startYear": 2024,
    "suffix": "All rights reserved."
  },
  "support": {
    "email": "support@example.com",
    "phone": "",
    "helpUrl": "https://example.com/help"
  },
  "branding": {
    "defaultBrand": "default"
  },
  "localization": {
    "defaultLocale": "en",
    "supportedLocales": ["en", "te", "hi"]
  }
}
All example values are illustrative. Preserve actual repository values when available.

4.2 Configuration implementation

Import configuration through a single typed module.
Validate the JSON structure at build time.
Derive TypeScript types from the schema or validate against a maintained schema.
Expose a stable, documented public API.
Avoid duplicating configuration values in application components.
Avoid hardcoding company details in page layouts, footers, headers, or support components.
Keep public configuration free of secrets and sensitive information.
Keep environment-specific deployment configuration separate from public application configuration.
Do not use runtime environment variables in statically generated output unless their build-time behavior is intentional and documented.
Create reusable components or utilities for application identity, support details, and copyright where these are needed.

Copyright behavior must handle the current year correctly. Decide whether the year is calculated at runtime, supplied at build time, or refreshed through an annual build. Avoid invalid year ranges.

5. Shared localization with i18next

5.1 Dependencies

Use:

i18next
react-i18next
Select compatible versions based on the repository's existing framework and dependency versions.

Do not add a second translation library unless a documented requirement justifies it.

5.2 Translation namespaces

Use the following logical namespaces:


Namespace	Admin	Resident
common	Shared	Shared
validation	Shared	Shared
admin	App-specific	Not required
resident	Not required	App-specific
Add further namespaces only when they improve organization, loading performance, or maintainability.

5.3 Translation key conventions

Use stable, semantic keys.
Keep shared keys in shared namespaces.
Never use English sentences as translation keys.
Never hardcode user-facing text in React components when it belongs to the localization system.
Do not duplicate shared translations between applications.
Keep context-specific messages in app-specific namespaces.
Preserve identical interpolation variables across locales.
Support pluralization through i18next's pluralization conventions.
Use interpolation for dynamic values instead of manually concatenating translated sentences.
Escape or render user-provided content safely according to the application's React security conventions.
Example:


{
  "actions": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete"
  },
  "messages": {
    "welcome": "Welcome to {{productName}}",
    "loading": "Loading..."
  }
}
React component example:


"use client";

import { useTranslation } from "react-i18next";

export function SaveButton() {
  const { t } = useTranslation("common");

  return (
    <button type="button">
      {t("actions.save")}
    </button>
  );
}
Use the same key in both applications whenever the meaning is identical.

5.4 Next.js integration

Determine whether each application uses the App Router, Pages Router, or a combination.

For the App Router:

Initialize translations correctly for server rendering.
Use the current locale when loading resources.
Provide a client-side translation provider only where needed.
Use Server Components for content that does not require client-side interactivity.
Keep server-rendered and client-rendered translations consistent.
Use locale-specific routes when appropriate.
Support static generation for supported locales.
Avoid loading every locale and namespace into every page.
Ensure that concurrent requests cannot interfere with each other's active locale.
Avoid relying on a mutable singleton i18next instance whose language is changed per request.
Ensure that client-side locale changes update the URL and displayed translations consistently.
Follow the repository's existing hydration and routing conventions.
For the Pages Router, use the appropriate integration for that router rather than copying App Router patterns.

Do not introduce middleware or runtime-only routing dependencies if they conflict with the application's static-export requirements.

6. Locale configuration

Maintain a single source of truth for supported locales.

Initial locales:

English: en
Telugu: te
Hindi: hi
Additional Indian languages may include Tamil (ta), Kannada (kn), Malayalam (ml), Marathi (mr), Bengali (bn), Gujarati (gu), Punjabi (pa), Odia (or), Assamese (as), and Urdu (ur).

Do not require all listed languages to be translated in the initial implementation. Enable only locales that the application can support according to the agreed release policy.

Requirements:

Use consistent locale identifiers in configuration, routing, and resource directories.
Use English as the default locale unless existing product requirements specify otherwise.
Validate that every configured locale has the required translation resources.
Use Intl APIs for localized dates, numbers, and currency.
Support Unicode correctly.
Account for right-to-left layout when Urdu is enabled.
Do not assume language changes automatically handle every layout or formatting requirement.
Ensure that locale routing works with the configured Next.js deployment mode.
Do not maintain independent locale lists in Admin and Resident.

7. Fallback translation policy

Implement an explicit English fallback strategy.

Expected resolution:

Look up the key in the requested locale.
If missing, resolve the key from English.
If still missing, use the configured missing-key handling.
Report missing keys in development and CI.
Use supported i18next fallback configuration where appropriate.

Do not assume that configuring a fallback locale automatically merges complete English JSON objects into localized resources. Verify actual behavior for the chosen loading strategy.

If dictionary merging is required, implement it explicitly or use a documented i18next resource-loading strategy.

Missing translation policy

Critical payment, security, consent, and account-action content must have reviewed translations before release.
Required UI keys must pass CI validation.
Optional content may use English fallback only when explicitly allowed by policy.
Missing keys must never silently become an empty string.
Unknown locales must be handled through the application's defined 404 or redirect policy.
Missing configuration values must not silently select another company's identity or branding.
Provide useful diagnostics identifying the locale, namespace, and missing key.

8. Branding configuration and assets

Branding must remain separate from localization and application business settings.

Support:

Primary logo.
Dark-background logo.
Favicon.
Application icons.
Login and onboarding illustrations.
Theme colors.
Font references.
Other approved visual assets.
Example brand configuration:


{
  "brandId": "default",
  "assets": {
    "logo": "/brands/default/logo.svg",
    "logoDark": "/brands/default/logo-dark.svg",
    "favicon": "/brands/default/favicon.ico"
  },
  "theme": {
    "primaryColor": "#2457A7",
    "fontFamily": "Inter"
  }
}
Requirements:

Keep asset references in configuration rather than hardcoding them in components.
Resolve asset references through a typed branding module.
Validate that referenced local assets exist.
Use a documented fallback brand only when appropriate.
Do not invent or generate replacement company logos.
Preserve existing branding unless a replacement is explicitly requested.
Use stable asset paths and ensure that assets are copied or served correctly in production.
Validate supported color formats and other theme values.
Avoid unrestricted arbitrary asset paths.
Keep font licensing and asset ownership requirements intact.
If Admin and Resident require different visual identities, allow app-specific branding overrides while retaining shared defaults.

If the platform serves multiple tenants, do not assume a single static brand configuration is sufficient. First determine whether tenants have separate builds or share a single deployment.

9. Static content and scope boundaries

Keep different kinds of data in the correct system.


Content	Storage
UI labels, buttons, validation messages	Translation JSON
Company name and support details	Application configuration
Logos, favicons, illustrations	Static public assets
Theme settings	Branding configuration
FAQs and help content	Structured content JSON, if in scope
Live user and property information	Existing API or database
Secrets and credentials	Approved secret-management system
Do not move live business data into static JSON.

Do not introduce a CMS, database, translation API, or remote configuration service for the requirements in this document.

Treat all configuration shipped to the browser as public.

10. Build-time validation

Create validation scripts and integrate them into the repository's existing CI process.

The validation pipeline must check:

Configuration

JSON syntax is valid.
Required configuration fields exist.
Values have the correct types.
URLs and contact details meet applicable validation rules.
Supported locales exist and are unique.
The default locale is included in the supported locale list.
Brand identifiers and references are valid.
Translations

Every enabled locale contains required namespaces.
Required keys exist in English.
Required keys have translations in enabled locales.
Unexpected keys are reported.
Interpolation placeholders are consistent.
Pluralization keys follow i18next conventions.
Translation values use supported types and formats.
Missing translations follow the agreed release policy.
Assets

Referenced local assets exist.
Asset paths are valid and safe.
Required logos and favicons are present.
Branding configurations reference valid assets.
Build quality

TypeScript passes.
Linting passes.
Relevant unit tests pass.
Admin builds successfully.
Resident builds successfully.
Validation failures must return a nonzero exit code and block deployment when required checks fail.

Avoid introducing unnecessary new tooling if existing schema validation or test libraries can handle these requirements.

11. Testing requirements

Add tests for the following cases:

Configuration loads correctly.
Invalid configuration fails validation.
Default locale is resolved correctly.
Every enabled locale loads the correct namespace.
Shared translation keys return the expected values.
English fallback resolves missing localized keys.
Missing keys produce useful diagnostics.
Interpolation works for dynamic values.
Pluralization works correctly.
Admin and Resident use the same shared translation resources.
Brand asset references resolve correctly.
Invalid or missing assets fail validation.
Copyright year ranges are correct.
Locale routing works for the supported deployment mode.
Server rendering and client hydration use consistent translations.
Non-Latin scripts render correctly.
Right-to-left behavior works when an RTL locale is enabled.
Use the repository's existing testing framework. Add integration or end-to-end tests where appropriate without duplicating existing coverage.

12. CI and developer workflow

Integrate validation into the existing package scripts and CI configuration.

Suggested logical commands:


config:validate
i18n:validate
branding:validate
typecheck
lint
test
build:admin
build:resident
Use the actual package manager and workspace conventions found in the repository.

The required release sequence is:

Developer updates JSON or approved assets.
Code review approves the changes.
Configuration, translation, and asset validation run.
Tests and type checks run.
Both applications build successfully.
The validated artifacts are deployed.
Document how developers:

Add a new locale.
Add a shared translation key.
Add an app-specific translation key.
Update company details.
Update copyright information.
Change branding assets.
Add or change a theme token.
Investigate missing-key errors.
Do not claim that build-time JSON changes appear in production without rebuilding and deploying.

13. Implementation sequence

Implement in these phases.

Phase 1 — Repository assessment

Identify the existing applications, dependencies, routing, deployment mode, configuration patterns, and current localization approach.

Phase 2 — Shared platform

Create or extend the shared package and expose typed configuration, locale definitions, localization utilities, and branding APIs.

Phase 3 — Configuration and branding

Move duplicated company details and asset references into centralized configuration while preserving existing behavior.

Phase 4 — Localization

Integrate i18next and react-i18next, establish namespaces, add English resources, enable approved Indian languages, and implement fallback behavior.

Phase 5 — Application integration

Update Admin and Resident components to consume the shared configuration, translations, and branding utilities.

Replace hardcoded user-facing strings in the agreed implementation scope.

Phase 6 — Validation and testing

Add configuration schemas, translation parity checks, placeholder validation, asset checks, and relevant tests.

Phase 7 — Build and documentation

Run checks and production builds for both applications. Document setup, developer workflows, limitations, and deployment behavior.

Avoid unrelated refactoring.

14. Acceptance criteria

The implementation is complete only when all applicable criteria pass.

Admin and Resident consume the same shared platform.
Application configuration is centralized and typed.
Company name, product name, copyright, and support details are not duplicated across components.
Branding assets are referenced through configuration.
i18next and react-i18next are integrated correctly with the existing Next.js router.
Shared keys are reused across applications.
App-specific translations remain separate.
English is the configured default locale.
Approved Indian-language resources load correctly.
Missing translations follow the documented English fallback policy.
Missing required keys fail CI validation.
Interpolation and pluralization are validated.
Invalid configuration and missing required assets fail validation.
Server rendering and client hydration remain consistent.
Both applications pass applicable tests and production builds.
No secrets are exposed through public configuration.
Developer documentation explains how to maintain configuration, translations, and branding.
15. Final reporting requirements

After implementation, provide a concise report containing:

Summary of the architecture implemented.
Files created or modified.
Dependencies added or reused.
How Admin and Resident consume the shared package.
How configuration, localization, and branding work.
Fallback behavior and validation rules.
Commands executed and their results.
Any acceptance criteria not completed.
Remaining risks or decisions requiring product-owner input.
Do not report tests or builds as passing unless the corresponding commands were actually executed successfully.

Final engineering principle: Keep configuration, localization, and branding logically independent but versioned and validated together. Both applications must consume a consistent, tested implementation without introducing unnecessary runtime dependencies.