# David + Goliath Platform

This repository is the consolidation point for **David** and **Goliath**.

## Canonical products

- **David** — public website and customer/commercial lifecycle.
- **Goliath** — governed project-control application.

They share one engineering platform but remain independently deployable and independently authorised applications.

## Production URLs

- Goliath: https://goliath-project-management-tracker.vercel.app/
- Legacy David rollback/reference: https://david.dippurajthapa.chatgpt.site/

## Architecture authority

Read `docs/architecture/NORTH_STAR.md` before changing product boundaries, data ownership, identity, authorization or workflow behavior.

The temporary simplified Goliath Vercel UI is an acceptance bridge. The previously validated full Goliath source and its 236-test regression are now restored under `packages/goliath-core`; the Neon named-user candidate remains under acceptance.

The signed David -> Goliath organisation-entitlement boundary is implemented under `packages/identity-contracts`, with append-only receipt/admission persistence in the Goliath migration set. It grants no project or individual authority; server-side runtime integration remains pending.

## Repository direction

```text
apps/
  david/
  goliath/
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

Migration is controlled: replacement paths must pass affected end-to-end acceptance before legacy paths are retired.

Current release posture: the canonical hosted bridge remains the rollback/reference surface. The write-enabled named-user candidate is local-development only until cross-role, governed-workflow and hosted network/OAuth acceptance pass.
