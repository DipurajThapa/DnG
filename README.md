# Goliath Project Management Tracker

This repository is the Git-backed deployment source for **Goliath**, the renamed Project Management Tracker.

- Production URL: https://goliath-project-management-tracker.vercel.app/
- Vercel project: `goliath-project-management-tracker`
- Production branch: `main`
- Validated source baseline: 236/236 automated tests PASS; TypeScript build PASS.

## Repository layout

- `index.html` — stable same-origin Goliath entry shell.
- `app.html` — direct-render validated browser review surface.
- `goliath-head.png` — approved image-only Goliath head used for the product icon/favicon.
- `RELEASE_VALIDATION.md` — release/validation evidence and runtime boundary.
- `DAVID_LINK_UPDATE_REQUIRED.md` — exact David website handoff patch and current source-access blocker.

The full production-capable source baseline uses a dedicated Node/PostgreSQL runtime. This Vercel project intentionally hosts the browser review surface only; it does not pretend the production database/worker stack is running as a static site.
