# Goliath Release Candidate Runbook

## Purpose

Promote one tested artifact without allowing the development runtime or development database to become production by accident.

## Entry gates

- `main` static and contract checks pass.
- `packages/goliath-core` builds and all 236 regression tests pass.
- Sponsor and Team Member session-bound access probes pass from their own identities.
- The governed workflow passes through UI, authentication, authorization, API, persistence, audit, reporting and logout/login continuity.
- A separate authorised person completes the decision or baseline approval step.
- For customer-onboarding releases, signed entitlement issuance/consumption passes active, grace, restricted, revoked, expired, tampered and replay scenarios without creating project authority.
- Backup/restore, monitoring, rate-limit and rollback owners are recorded.

## Release configuration

Create a release-specific runtime configuration that contains only public endpoint identifiers. Keep secrets in Vercel environment variables or the approved secret manager.

The release configuration must define:

- canonical and preview origins;
- production Auth and Data API endpoints;
- matching Auth callback, CORS and CSP origins;
- production schema/API boundary;
- a release identifier and environment label.

Never add a production origin to the local-development allowlist and never add the production backend to the development CSP.

## Candidate flow

1. Build a preview artifact from the accepted commit.
2. Run automated checks against that exact artifact.
3. Run the real-user browser acceptance suite against the preview.
4. Inspect deployment logs and application/audit events.
5. Record the release decision and evidence.
6. Promote the already-tested preview artifact to production; do not rebuild a different artifact for promotion.
7. Run post-promotion smoke, error-log and audit checks.
8. Keep the previous production deployment available for rollback during the agreed window.

## Stop conditions

Do not promote when any of the following is true:

- runtime origin, Auth, Data API, CORS or CSP do not agree;
- a role can read or write outside its governed scope;
- a commercial entitlement can create a user, team, project membership, responsibility or permission;
- an allowed state transition does not persist or appear in audit/report projections;
- a denial depends only on hidden UI;
- a production metric or financial value is fabricated from missing data;
- the exact preview artifact tested cannot be identified;
- rollback or backup/restore evidence is absent.
