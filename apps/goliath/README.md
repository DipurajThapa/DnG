# Goliath web application

This directory is the target Vercel root for the Goliath web application.

## Current state

This directory contains the named-user development candidate for Goliath Project Control & Decision Intelligence. It is connected to the isolated `goliath-development` Neon branch through `runtime-config.js`, accepts only approved local origins, and is intentionally separate from the anonymous, read-only production bridge at the repository root.

Implemented development capabilities include named-user Auth linking, identity-bound responsibility contexts, governed commitment/evidence/decision workflows, immutable baseline controls, role-aware projections, reporting, diagnostics, invitations and audited real-user acceptance probes.

The exact validated source package is now under Git control at `../../packages/goliath-core` and passes 236/236 regression tests. This development candidate must still pass its own real-user, cross-role and end-to-end acceptance gates before release.

## Production rule

Do not replace the production bridge until this candidate has passed the release gates in `../../docs/architecture/DEVELOPMENT_ACCEPTANCE_2026-09-12.md`. Named users must receive only the responsibilities bound to their authenticated identity. Configuration coverage or same-user role switching is not valid multi-user acceptance evidence.

Automatic Vercel deployment is disabled for this directory. Enabling a hosted candidate requires a deliberate production/release runtime configuration, aligned Auth/CORS/CSP settings and a recorded release decision.

See `../../docs/architecture/NORTH_STAR.md` and `../../docs/architecture/ROLE_AUTHORITY.md`.
