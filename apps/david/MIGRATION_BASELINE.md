# David migration baseline

## Source evidence

Current legacy Site: `https://david.dippurajthapa.chatgpt.site/`

Recovered implementation inventory from the latest saved David review includes:

- `app/page.tsx`
- `app/site-header.tsx`
- `app/site-shell.tsx`
- `app/pricing/page.tsx`
- `app/contact/request-form.tsx`
- `app/workspace/page.tsx`
- resource/operator/API routes
- `lib/catalog.ts`
- `lib/enquiries.ts`
- `lib/operator-records.ts`
- `lib/access.ts`
- `lib/store.ts`
- `lib/site-content.ts`
- `lib/seo.ts`
- `db/schema.ts`

Saved David version reviewed: version 9, source commit recorded as `b86b1c788e84d5385711917c4fc64b6128f3474e`.

The original repository/checkout is not currently exposed through the connected GitHub or ChatGPT Site interfaces, so the migration is a controlled reconstruction rather than a source export.

## Visible public experience to preserve

- David brand and public navigation
- Product, Solutions, Deployment & pricing, Blog & resources
- Request a demo / contact conversion path
- Project command center illustrative example clearly labelled as synthetic
- Baseline vs progress educational content
- Decision/accountability guidance
- Weekly reporting guidance
- Deployment responsibility guidance
- Legal/footer links
- My enquiries / account-check entry points where applicable

## Product boundary

David is the vendor/customer lifecycle application. It must not become a second project-management truth store.

David may establish customer, order, entitlement, organisation-bootstrap and admission evidence. Goliath remains responsible for project-control data and project-level authorization.

The shared `packages/identity-contracts` foundation now defines a signed Ed25519 organisation-entitlement envelope. It intentionally excludes user, role, team, project-membership and permission fields. Runtime issuance and consumption remain disabled until server-side key management and atomic receipt persistence are connected.

## Required integration correction

Legacy behavior recorded in the prior implementation audit:

`/workspace` -> fixed external EDAPOS Project Management Tracker link.

Target behavior:

`/workspace` -> canonical Goliath admission at `https://goliath-project-management-tracker.vercel.app/`

All shared header/footer `Open workspace` links must use the same canonical destination or admission route.

A successful enquiry, payment redirect, matching business domain or organisation-admin role must never by itself grant Goliath project access.

## Consolidated platform target

```text
DnG/
  apps/
    david/       # public website / commercial and customer lifecycle
    goliath/     # project management application
  packages/
    goliath-core/
    identity-contracts/
    authorization/
    audit/
    shared-ui/
  db/
    david/
    identity/
    goliath/
  docs/
    architecture/
    workflows/
    acceptance/
```

David and Goliath remain independently deployable even though they share one repository and platform.

## Cutover gates

1. Reconstruct David routes and current visible content in GitHub.
2. Preserve enquiry/contact behavior and explicitly mark non-live commercial functions until connected.
3. Replace all tracker handoffs with canonical Goliath admission.
4. Add named identity/customer continuation before enabling protected customer functions.
5. Run link/navigation/responsive/accessibility smoke tests.
6. Validate persisted data path and recovery behavior.
7. Deploy David as a separate Vercel project from `apps/david`.
8. Verify David -> Goliath end-to-end navigation and authorization boundaries.
9. Keep legacy ChatGPT Site available until acceptance passes.
10. Only then retire or redirect the legacy David Site.

The North-Star product and acceptance rules in `docs/architecture/` are authoritative for the migration.
