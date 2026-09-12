# Goliath Development Acceptance — 12 September 2026

**Branch:** `develop/goliath`  
**Development database:** Neon `goliath-development` (`br-cool-field-aupbzqgf`)  
**Production/main touched:** No  
**Vercel required:** No

## Decision

**Structural / contract acceptance: PASS**  
**Named-user browser acceptance: BLOCKED pending first real development identity sign-in**  
**Production release decision: NOT APPLICABLE / NOT READY**

This record covers the off-Vercel development environment only. It must not be used as evidence that the production URL or final OAuth/browser journey has passed acceptance.

## Product-direction acceptance

PASS:

- Goliath is presented as **Project Control & Decision Intelligence**, not a Project Management Tracker.
- Commitment remains the management root.
- Execution tasks remain evidence / serving work rather than the permanent management root.
- Requirements, decisions, dependencies, RAID, baseline/change, health, capacity and reports operate against the same governed project-control model.
- Familiar reports are projections of governed state rather than separate status datasets.
- Missing finance/capacity/reporting data is represented as unavailable/data-insufficient; no unsupported actual cost, margin or EAC is fabricated.
- Consequential baseline/change/RAID/decision actions retain named-human authority.

## Development CI

Latest checked CI before this acceptance record:

- Workflow: **Goliath Development CI**
- Branch: `develop/goliath`
- Commit: `8b25772d88c343da7d63b736baa82fa2503490ae`
- Result: **SUCCESS**

CI validates:

- JavaScript syntax;
- isolated development runtime configuration;
- Vercel deployment-disabled boundary for `develop/goliath`;
- product-direction guardrails;
- required migration set;
- governance UI action contracts;
- baseline immutability migration;
- integrated development contract checks.

## Database invariants

All checked violations returned **0**:

- active commitment missing required control perimeter;
- AI-proposed requirement link counted as confirmed;
- applied change missing new baseline;
- approved baseline missing approval/provenance;
- confirmed commitment candidate missing commitment;
- duplicate pending initial-baseline approval;
- evidence link missing minimum provenance;
- pending decision missing owner or needed-by;
- requirement missing source provenance;
- risk exposure mismatch.

## Authorization / exposure

PASS:

- governance RPCs are executable by `authenticated` only;
- anonymous / `goliath_web_anon` / PUBLIC do not have governance RPC execution;
- authenticated/browser roles have no direct table grants to Requirements, RAID, Baseline, Change, Notification, Escalation or Rate Card control tables;
- renamed internal governance implementations are not executable by browser/authenticated roles;
- governance wrappers enforce the identity/responsibility/data-class boundary and delegate to the existing scoped implementations;
- unauthenticated development DB session resolves no Goliath user (`current_user_id() = null`).

## Baseline immutability

PASS.

`pc_baselines` is protected at the database boundary by:

- `trg_pc_baselines_no_update`
- `trg_pc_baselines_no_delete`

Both invoke the append-only mutation rejection function. Baseline history therefore cannot be rewritten or deleted through normal table mutation.

## Runtime health

PASS at inspection time:

- no queries running longer than five minutes;
- no held database locks.

## Workflow-contract coverage

Structurally connected in development:

1. imported milestone → commitment candidate;
2. human confirmation → governed commitment;
3. methodology + evidence specification → activation readiness;
4. evidence → deterministic four-dimension health;
5. decision → named decider / delegate;
6. dependency → provider / consumer acknowledgement;
7. RAID → linked risk / issue / assumption;
8. deterministic RAID trigger → issue candidate → human conversion;
9. requirements → typed confirmed traceability links;
10. initial baseline → different named approver → Decision Queue → immutable snapshot;
11. material change → impact → approval Decision → real baseline delta → new baseline;
12. responsibility notification → acknowledge / snooze / resolve;
13. escalation stops at external boundary pending human action;
14. reporting renders the same governed state and can create immutable report snapshots;
15. capacity/planned-cost projections return data-insufficient where authoritative data is absent.

## Development-data state

The controlled `GOLIATH-DEV` brownfield source intentionally remains at the establishment stage:

- proposed commitment candidates: 14;
- confirmed commitments: 0;
- requirements: 0;
- RAID items: 0;
- approved baselines: 0;
- change requests: 0.

This is intentional. Development data has not been altered merely to manufacture a passing business workflow. Positive state transitions should occur through authenticated governed actions.

## Blocked acceptance

### Real named-user authentication and browser journey — BLOCKED

Current isolated development Auth state:

- Neon Auth users: 0;
- Goliath identity links: 0;
- responsibility assignments exist, but none are bound to a real development Auth identity yet.

Therefore the following remain unverified and must not be called passed:

- Google sign-in on localhost;
- first real identity link/bootstrap;
- responsibility/context resolution from a real JWT;
- positive browser UI → Auth → RPC → persistence journey;
- second-user invitation claim;
- cross-user/cross-context browser denial using real sessions;
- logout/login continuity.

No fake JWT, role bypass or fabricated auth user will be used to close this gate.

## Remaining release gates

Before a hosted release candidate:

1. complete a real named-user local acceptance session;
2. run at least two identities / distinct responsibilities and cross-context denial tests;
3. execute the full governed business chain on development data;
4. verify audit events and downstream report projections after each material state transition;
5. run regression and security checks again;
6. then create one cohesive hosted release candidate for final OAuth/network/browser acceptance.

## Next allowed development scope

Structural acceptance is sufficient to continue with capabilities that do not depend on fabricating the blocked identity journey:

- connector/integration health and reconciliation visibility;
- field-ownership / evidence-coverage diagnostics;
- outcome instrumentation (administrative effort, detection lead time, decision latency, evidence coverage, freshness, notification noise);
- additional validation tooling.

Do not merge to `main` or deploy to production solely because this development acceptance record exists.
