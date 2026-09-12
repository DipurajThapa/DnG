# Goliath web application

This directory is the target Vercel root for the Goliath web application.

## Current state

The files currently copied here reproduce the connected acceptance bridge served from the repository root. This bridge is **not** the final functional baseline.

The authoritative functional baseline is the validated Goliath source package that passed 236/236 regression tests and the earlier end-to-end browser/product audit. That runtime is being imported under `packages/goliath-core` and then wired into this web application without discarding its guarded writes, role journeys, workflow state, traceability or recovery behavior.

## Production rule

The anonymous acting-context selector is for controlled acceptance only. Production named users must receive only the responsibility contexts authorised for their authenticated identity.

See `../../docs/architecture/NORTH_STAR.md` and `../../docs/architecture/ROLE_AUTHORITY.md`.
