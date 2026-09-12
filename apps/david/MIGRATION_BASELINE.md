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

The original repository/checkout is not currently exposed through the connected GitHub or ChatGPT Site interfaces, so the migration must be treated as a controlled reconstruction rather than a source export.

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

## Required integration correction

Legacy behavior recorded in the prior implementation audit:

`/workspace` → fixed external EDAPOS Project Management Tracker link.

Target behavior:

`/workspace` → `https://goliath-project-management-tracker.vercel.app/`

All shared header/footer `Open workspace` links must use the same canonical target.

## Consolidated platform target

Recommended repository structure after migration:

```text
DnG/
  apps/
    david/       # public website / commercial entry
    goliath/     # project management application
  packages/
    shared-ui/
    shared-config/
    identity-contracts/
  docs/
    architecture/
    migration/
```

David and Goliath should remain independently deployable applications even though they share one repository and platform. This keeps release, security and failure boundaries clear while eliminating cross-platform drift.

## Cutover gates

1. Reconstruct David routes and current visible content in GitHub.
2. Replace all tracker handoffs with canonical Goliath URL.
3. Run link/navigation/responsive/accessibility smoke tests.
4. Validate enquiry/contact behavior and any persisted data path being migrated.
5. Deploy David as a separate Vercel project from `apps/david`.
6. Verify David → Goliath end-to-end navigation.
7. Keep legacy ChatGPT Site available until acceptance passes.
8. Only then retire or redirect the legacy David Site.
