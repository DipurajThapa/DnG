# Goliath pre-cutover acceptance — 12 September 2026

## Candidate

- Branch: `precutover-goliath`
- Candidate commit before this report: `8c249625da1e9d2ce1d3866db8af364c8e00be93`
- Intended production URL after cutover: `https://goliath-project-management-tracker.vercel.app/`
- Canonical target source: `apps/goliath/`

## Decision

**NO-GO / BLOCKED FOR CUTOVER** until the remaining gates below are closed.

## Passed

1. Exact validated Goliath baseline rerun: TypeScript build PASS; 236/236 tests PASS; 0 failed/skipped/cancelled.
2. Named-user target uses Google/Neon Managed Auth rather than arbitrary production-role selection.
3. Data API exposes only `goliath_api`; OpenAPI disabled; CORS restricted to the canonical Goliath production origin.
4. Auth redirect whitelist contains only the canonical Goliath production origin.
5. Anonymous/public DB roles cannot execute guarded write RPCs. Authenticated role has execute capability, with each RPC performing its own identity/context/role/scope checks.
6. Guarded write surface includes activity update, assignment, handoff create/respond, resource demand, allocation, decision resolution, identity invitation, and responsibility grant/revoke.
7. Governed identity admission includes verified-email invitation claim, one-time initial bootstrap, and last-Enterprise-Admin safeguards.
8. Database health: no long-running queries and no held locks in the acceptance check.
9. Repository code search returned no current `EDAPOS` product branding matches.
10. Backend named-user projection strips finance for non-finance roles and strips project/work projections for Enterprise Admin and Resource Manager before returning browser data.

## Blocking findings

### B1 — Navigation must match backend projection
The target UI still exposes empty destinations for roles whose backend intentionally strips those datasets:
- Enterprise Admin: `Projects` should not be shown.
- Resource Manager: `Projects` and `Money` should not be shown.
- PMO: `Money` should not be shown.

This is a UX/dead-end blocker, not a backend authorization bypass. It must be corrected before cutover.

### B2 — First real named-user browser acceptance has not occurred
`platform_identity.user_links` currently has no production identity links. The initial owner must sign in through Google on the canonical/trusted Goliath origin and claim the one-time bootstrap. After that, acceptance must prove:
- only that user's permitted responsibility contexts are returned;
- cross-context/foreign assignment requests are denied;
- sign-out and re-login preserve correct identity resolution;
- Enterprise Admin invitation claim works for a second named user.

### B3 — Vercel preview/canonical build currently rate-limited
The pre-cutover branch triggered Vercel's account-level deployment rate limit. The canonical and temporary Goliath projects report `Deployment rate limited — retry in 24 hours` for the latest candidate. Therefore a fresh deployment/browser/network acceptance of this exact candidate is not yet available.

## Cutover gate

Cutover is permitted only after B1 is fixed, Vercel accepts a fresh candidate build, and B2 is executed on that deployed build. Then run final browser acceptance for login, responsibility switching, role-specific navigation, read projections, guarded writes, audit propagation, refresh/deep-link behavior, responsive layout, console/network errors, CSP/auth callbacks, and rollback readiness.
