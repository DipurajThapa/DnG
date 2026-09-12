# Goliath release validation

Release date: 12 September 2026

## Deployment

- Production URL: https://goliath-project-management-tracker.vercel.app/
- Deployment source: `DipurajThapa/DnG`, branch `main`
- Canonical Vercel project: `goliath-project-management-tracker`
- Frontend status: role-aware browser application connected to the API/database projection.

## Connected runtime path

The hosted read path is now:

`Browser UI -> Neon Managed Better Auth anonymous short-lived JWT -> Neon Data API -> goliath_api SECURITY DEFINER functions -> PostgreSQL`

Controls:

- Data API CORS is restricted to the canonical Goliath production origin.
- Only the `goliath_api` schema is exposed through Data API.
- Data API OpenAPI exposure is disabled.
- Browser users do not receive a PostgreSQL password or permanent shared JWT.
- `goliath_web_anon` has no direct table grants.
- Public API access is limited to the read-only `list_contexts()` and `workspace()` projections.
- `vercel.json` applies CSP, frame denial, MIME sniffing protection, referrer policy and restricted browser permissions.
- The Neon SDK is version-pinned in the deployed page rather than using an unpinned `latest` dependency.

## Role/context integration validation

The database-backed workspace projection was exercised for all 18 configured responsibility contexts. Returned role and scope varied at the backend layer rather than only in frontend state.

Verified examples include Project Manager, Program Manager, Portfolio Manager, Project Director, PMO, Resource Manager, Sponsor, Delivery Lead, Agile Delivery Lead, Team Member and Enterprise Admin.

Enterprise Admin directory projection returns 18 known users. Team and resource views are scoped according to the selected responsibility context.

## Validated full-source baseline

The renamed Goliath source package was produced from the latest validated Project Management Tracker / user-directory-fixed baseline.

Retained validation from the exact renamed source:

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

The full validated backend/source package intentionally retains migration-safe compatibility fallbacks where removing them could break existing environments:

- legacy `x-edapos-*` inbound webhook headers after preferred `x-goliath-*` headers;
- legacy `EDAPOS_*` environment variables after preferred `GOLIATH_*` variables.

These are compatibility aliases, not user-facing product branding.

## Production gates still required before customer write access

The current hosted surface is intentionally read-only. It is suitable for connected acceptance and role-view validation, but customer write operations must not be enabled until authenticated identity is bound server-side to the user's permitted responsibility contexts.

Required launch gates for write-enabled production:

1. named-user authentication / approved enterprise identity provider;
2. server-side identity-to-organisation/project/responsibility binding;
3. guarded write endpoints from the validated backend package;
4. live multi-user write acceptance and cross-role denial testing;
5. production data/tenant onboarding rather than synthetic/preproduction fixtures.

Neon branch protection and automatic snapshot scheduling were attempted but are unavailable under the current project/plan limits. No existing protected branch or backup policy was weakened to work around those limits.

## David handoff

The canonical Goliath destination is:

`https://goliath-project-management-tracker.vercel.app/`

The live David native Site still requires its fixed `/workspace` EDAPOS destination to be replaced with this URL. The editable David source/native Site write surface is not exposed through the connected GitHub or Library tools in this execution environment, so this release does not claim the David live site has been modified.
