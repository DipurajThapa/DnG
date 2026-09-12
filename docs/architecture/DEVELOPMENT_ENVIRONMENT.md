# Goliath Development Environment

**Status:** Active development baseline  
**Date:** 12 September 2026  
**Purpose:** Continue Goliath development without relying on Vercel until a cohesive release candidate is ready.

## Branches

- GitHub development branch: `develop/goliath`
- Stable/release branch: `main`
- Neon development branch: `goliath-development`
- Neon development branch id: `br-cool-field-aupbzqgf`
- Parent data branch: `goliath-web-integration` (`br-lively-morning-au7ns3pe`)

`main` and the current production URL are not the active development workspace.

## Deployment rule

Normal development must not depend on Vercel. The development branch carries Vercel ignore rules so non-main work is skipped by the deployment build path. Vercel is a release-candidate gate, not an inner-loop development tool.

Development sequence:

1. design/requirement change on `develop/goliath`;
2. schema/API work on `goliath-development`;
3. local/static browser run where required;
4. unit, integration, negative/security and regression checks;
5. requirement and deviation traceability update;
6. only when a cohesive release candidate exists, prepare hosted acceptance;
7. deploy once for final browser/network/auth callback acceptance;
8. merge/cut over only after acceptance passes.

## Local browser origin

The development Neon branch is configured to accept:

- `http://localhost:3000`
- `http://127.0.0.1:3000`

for development authentication and Data API calls.

The production branch remains separately restricted to the canonical production origin.

## Data API boundary

The development Data API exposes only:

- schema: `goliath_api`
- anonymous role: `goliath_web_anon`
- OpenAPI mode: disabled

Direct public-table access is not the application contract. Browser interactions must use governed projections/RPCs.

## Development data rule

The Neon development branch was created from the current Goliath integration state so product work can be performed without modifying the parent integration branch.

Schema changes should be additive and reversible while the domain model is being reconciled. Do not destructively rewrite migration history to make a test dataset look cleaner.

## Architecture guardrail

The development environment exists to implement the governing product model, not to preserve accidental migration architecture.

Permanent direction:

`Commitment + Evidence + Decision Intelligence`

Tasks/activities from Jira, ADO, spreadsheets or other execution systems are primarily evidence serving commitments; they are not the permanent management root merely because the existing migration schema is activity-centric.

## Acceptance rule

A capability is not complete because a screen renders or a database row exists. Where applicable validation must cover:

`UI -> authentication -> authorization -> API/domain logic -> persistence -> audit -> downstream projection/report`

No release candidate proceeds to Vercel while known dead ends, cross-role data exposure, broken transitions, fabricated metrics or unresolved baseline deviations remain.
