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

The temporary simplified Goliath Vercel UI is an acceptance bridge. The previously validated full Goliath application remains the functional baseline that must be restored into the consolidated platform.

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
