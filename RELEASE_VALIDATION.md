# Goliath release validation

Release date: 12 September 2026

## Deployment

- Production URL: https://goliath-project-management-tracker.vercel.app/
- Deployment source: `DipurajThapa/DnG`, branch `main`
- Public surface: static browser review derived from the latest validated Project Management Tracker build.

## Validated source baseline

The renamed Goliath source package was produced from the latest validated Project Management Tracker / user-directory-fixed baseline.

Validation retained from the exact renamed source before release:

- Complete regression: **236/236 PASS**
- TypeScript build: **PASS**
- Focused user-directory validation: **3/3 PASS**
- Organisation directory path: **18 users** through service/workspace projection
- Enterprise Admin directory visibility: **PASS**
- Non-admin directory denial: **PASS**
- Supported responsibility-role coverage: **PASS**

## Branding validation

- Browser title: `Goliath Project Management Tracker`
- Public navigation/product copy: Goliath
- Image-only Goliath head: `goliath-head.png`
- Public deployable repository contains no required EDAPOS product branding.

## Compatibility references retained in the complete backend package

The full validated backend/source package intentionally retains only migration-safe compatibility fallbacks where removing them could break existing environments:

- legacy `x-edapos-*` inbound webhook headers after preferred `x-goliath-*` headers;
- legacy `EDAPOS_*` environment variables after preferred `GOLIATH_*` variables.

These are compatibility aliases, not user-facing product branding.

## Hosting boundary

The full validated runtime requires its dedicated Node process and PostgreSQL runtime profile. The Vercel deployment is the validated browser review surface; it does not falsely claim to run the production PostgreSQL/worker stack on a static host.
