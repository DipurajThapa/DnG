# GOLIATH PostgreSQL Runtime Persistence — 11 September 2026

This package continues the verified Phase 1–8 + production-binding baseline and completes the agreed next software step: make the canonical GOLIATH repositories runnable over PostgreSQL without duplicating domain logic or creating a second project model.

## Verified state

- One canonical project reality remains intact.
- Repository code now targets a small synchronous SQL port rather than `node:sqlite` directly.
- SQLite remains the local/test adapter.
- PostgreSQL has a production runtime adapter over the same repositories and services.
- PostgreSQL audit ordering uses explicit `append_seq` rather than SQLite `rowid`; source/effective timestamps remain evidence metadata, not chain order.
- Cumulative automated regression: **221/221 PASS**.
- PostgreSQL persistence focused tests: **7/7 PASS**.
- Final aggregate executable coverage: **98.38% lines / 82.66% branches / 95.45% functions**.
- Incomplete-code scan (`src`, `migrations`): **0 TODO/FIXME/HACK findings**.
- Canonical schema remains **43 business tables**; no parallel truth store was introduced.

## PostgreSQL runtime

Production configuration must include:

```text
GOLIATH_PERSISTENCE_DRIVER=postgres-sync
DATABASE_URL=postgresql://...
```

The PostgreSQL adapter is deliberately isolated behind the existing repository layer. It uses a synchronous PostgreSQL client and therefore should run in a dedicated Node worker/process profile rather than an edge runtime. Scale by adding application/worker processes, not by introducing dual writes.

## Run locally

```bash
npm test
npm run postgres:check
npm run audit
```

When the deployment environment has `pg-native`/libpq and a real `DATABASE_URL`:

```bash
npm run postgres:smoke
```

The smoke command checks PostgreSQL connectivity, canonical table count and the audit append-order columns before reporting the runtime persistence profile.

## Managed PostgreSQL verification

The additive PostgreSQL migration has been tested on a temporary managed-database branch. It adds only:

- `pc_project_events.append_seq BIGSERIAL`
- `ec_context_events.append_seq BIGSERIAL`
- one unique append-order index for each table

A deliberately backdated second event received the later `append_seq`, proving database append order is independent of source occurrence time.

**The tested migration has not been applied to a shared/pre-production parent branch.** Applying a managed-database migration is a consequential operation and requires explicit approval. See `docs/POSTGRES_RUNTIME_MANAGED_DB_VERIFICATION.json`.

## Remaining production boundary

The PostgreSQL runtime code path is implemented, but a real application process has not connected to the managed verification database through `pg-native` in this build environment because the native dependency could not be installed here. That live smoke must run in the intended deployment image/runtime.

Customer/environment-specific work still requires actual approved values: enterprise OIDC tenant/client, provider registrations, production secrets, approved database region/plan, worker deployment target, domain/TLS, monitoring/on-call routing and real-user pilot acceptance.

## UI/UX Lean Six Sigma review increment — 11 September 2026

The Phase 1–8 runtime UI has been redesigned into a business-facing, responsive, role-aware project-control experience. It no longer exposes raw canonical JSON.

Key surfaces: Attention, Projects, Overview, Plan, Work/My Work, People/Capacity, Money, Risks & Decisions, Delivery, Reports, Controls and Administration according to acting responsibility.

A standalone review artifact is included at:

`review/goliath-ui-review.html`

Design and acceptance evidence:

- `docs/UI_UX_SIX_SIGMA_DESIGN.md`
- `docs/UI_UX_REVIEW_ACCEPTANCE.md`

Full cumulative regression after the UI integration: **224/224 PASS**.

## UI/UX implementation hardening — 11 September 2026

The end-user review recommendations have now been implemented directly in the runtime:

- PM: Now / Next 7 days / Outlook control model plus complete project detail.
- Sponsor: executive decision-first view; routine Plan navigation removed.
- Team Member: focused My Work with management clutter removed.
- Resource Manager: one Capacity & Staffing workspace instead of duplicate Capacity/Demand/Allocation routes.
- Attention: What changed / Why it matters / Owner / Due / direct next-action CTA.
- Finance/evidence: progressive disclosure for secondary detail.
- Mobile: role-aware bottom shortcuts and labelled activity cards.
- Navigation: simplified without reducing authorised project depth.

Standalone review:

`review/goliath-ui-review.html`

Implementation evidence:

`docs/UI_UX_IMPLEMENTATION_REPORT.md`

Cumulative regression after implementation: **227/227 PASS**.
