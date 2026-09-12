# Goliath web application

This directory is the target Vercel root for the Goliath web application.

## Current state

This directory contains the named-user development candidate for Goliath Project Control & Decision Intelligence. It is connected to the isolated `goliath-development` Neon branch through `runtime-config.js` and is intentionally separate from the anonymous, read-only production bridge at the repository root.

Implemented development capabilities include named-user Auth linking, identity-bound responsibility contexts, governed commitment/evidence/decision workflows, immutable baseline controls, role-aware projections, reporting, diagnostics, invitations and audited real-user acceptance probes.

The validated source package that passed 236/236 regression tests remains historical evidence for retained behavior; this development candidate must still pass its own real-user, cross-role and end-to-end acceptance gates before release.

## Production rule

Do not replace the production bridge until this candidate has passed the release gates in `../../docs/architecture/DEVELOPMENT_ACCEPTANCE_2026-09-12.md`. Named users must receive only the responsibilities bound to their authenticated identity. Configuration coverage or same-user role switching is not valid multi-user acceptance evidence.

See `../../docs/architecture/NORTH_STAR.md` and `../../docs/architecture/ROLE_AUTHORITY.md`.
