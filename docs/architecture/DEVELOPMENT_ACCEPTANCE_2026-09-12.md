# Goliath Development Acceptance — 12 September 2026

**Branch:** `develop/goliath`  
**Development database:** Neon `goliath-development` (`br-cool-field-aupbzqgf`)  
**Production deployment touched:** No  
**Main code baseline:** merged previously; current role-coverage work remains on `develop/goliath` until validated  
**Vercel required:** No

## Decision

**Structural / contract acceptance: PASS**  
**First real named-user Google sign-in: PASS**  
**Multi-user / cross-role browser acceptance: BLOCKED pending second verified identity**  
**Production release decision: NOT READY**

This record covers the off-Vercel development environment only. It must not be used as evidence that a hosted production OAuth/browser journey has passed acceptance.

## Product-direction acceptance

PASS:

- Goliath is presented as **Project Control & Decision Intelligence**, not a Project Management Tracker.
- Commitment remains the management root.
- Execution tasks remain evidence / serving work rather than the permanent management root.
- Requirements, decisions, dependencies, RAID, baseline/change, health, capacity and reports operate against the same governed project-control model.
- Familiar reports are projections of governed state rather than separate status datasets.
- Missing finance/capacity/reporting data is represented as unavailable/data-insufficient; no unsupported actual cost, margin or EAC is fabricated.
- Consequential baseline/change/RAID/decision actions retain named-human authority.
- PMO Controls focuses on connector health, evidence freshness, field ownership and outcome measurement rather than duplicate status production.
- The responsibility selector is identity-bound and is explicitly **not** an acting-as role switch.

## Named-user acceptance

PASS for the first real development identity:

- Google OAuth completed on `http://localhost:3000`;
- Neon Auth created a real verified Auth user;
- the one-time bootstrap invitation for `admin1` was claimed;
- `platform_identity.user_links` contains one active Auth → Goliath identity link;
- the verified user resolves to the governed internal identity `admin1`;
- the browser successfully displays the authenticated Goliath dashboard;
- the signed-in identity resolves exactly two real responsibilities:
  - Enterprise Admin — organisation `ORG1`;
  - Project Manager — project `GOLIATH-DEV`.

A frontend blank-screen issue observed immediately after OAuth was traced to self-triggering navigation `MutationObserver` callbacks and corrected through the observer-guard hotfix. The successful post-hotfix dashboard load is accepted as evidence that the first named-user browser shell is functional.

## Role model / coverage

The supported role model is now centralised in `platform_identity.role_catalog` rather than being defined only by scattered UI conditionals.

Canonical supported roles:

1. Enterprise Admin
2. Portfolio Manager
3. Program Manager
4. Project Director
5. Project Manager
6. PMO / Project Controls
7. Resource Manager
8. Delivery Lead
9. Agile Delivery Lead
10. Team Member
11. Sponsor

For `GOLIATH-DEV`, all 11 roles now have at least one effective governed responsibility that covers the project through the appropriate project/program/portfolio/organisation/org-unit scope.

Only Enterprise Admin and Project Manager currently have a linked real Auth identity. The remaining role holders are deliberately configured but unlinked pending second-user/multi-user acceptance.

The UI now distinguishes:

- **My responsibilities** — only responsibilities actually assigned to the signed-in identity;
- **Role coverage** — Enterprise Admin visibility of all supported roles, scopes, project coverage and linked-identity readiness.

No arbitrary production-style role impersonation has been reintroduced.

## Development CI

The off-Vercel development workflow validates:

- JavaScript syntax for core, governance, PMO-control and role-model UI modules;
- isolated development runtime configuration;
- Vercel deployment-disabled boundary for `develop/goliath`;
- product-direction guardrails;
- required migration set;
- governance UI action contracts;
- baseline immutability migration;
- integration/outcome instrumentation contracts;
- legacy anonymous/public RPC lockdown;
- canonical role catalog and development role-coverage seed;
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
- no `goliath_api` function currently has `PUBLIC`, `anonymous`, or `goliath_web_anon` EXECUTE permission;
- authenticated/browser roles have no direct grants to public application tables;
- legacy anonymous acceptance APIs `list_contexts()` and `workspace(assignment)` are retained only as migration history and are no longer callable by browser/application roles;
- audit append helpers are internal-only so callers cannot fabricate project/context audit records;
- authorization helpers are internal implementation details rather than standalone browser APIs;
- renamed internal governance implementations are not executable by browser/authenticated roles;
- all authenticated exposed `goliath_api` functions checked use SECURITY DEFINER with a fixed search path;
- governance wrappers enforce the identity/responsibility/data-class boundary;
- unauthenticated development DB sessions resolve no Goliath user.

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
15. capacity/planned-cost projections return data-insufficient where authoritative data is absent;
16. integration health → binding/inbox/source/field-ownership diagnostics;
17. PMO outcome instrumentation → only evidence-supported measures are calculated.

## Outcome instrumentation status

Implemented measurement surfaces:

- **M1 Administrative effort** — measured only after both observed baseline and current samples exist;
- **M4 Decision latency** — calculated from governed decision creation/closure data;
- **M8 Evidence coverage** — calculated from active commitment evidence specifications and current evidence;
- **M9 Data freshness** — calculated from active evidence freshness states;
- **M12 Notification noise** — calculated from real notification response state.

Explicitly **data-insufficient** until additional governed evidence exists:

- M2 detection lead time;
- M3 warning precision;
- M6 capacity-conflict lead time;
- M11 AI trust;
- M13 onboarding effort.

No synthetic values are generated to make these measures appear complete.

## Development-data state

The controlled `GOLIATH-DEV` brownfield source intentionally remains at the establishment stage:

- proposed commitment candidates: 14;
- confirmed commitments: 0;
- requirements: 0;
- RAID items: 0;
- approved baselines: 0;
- change requests: 0.

This is intentional. Positive workflow state transitions should occur through authenticated governed actions rather than through database seeding merely to manufacture a passing business workflow.

## Remaining blocked acceptance

### Second identity / cross-role acceptance — BLOCKED

A second real verified identity is still required to prove separation between different people and responsibilities.

Still unverified:

- Enterprise Admin invitation issued to a second real Google account;
- second identity claim/link;
- Sponsor/Delivery/PMO/etc. positive role journey under a distinct identity;
- cross-user and cross-context denial using two real sessions;
- named decision approval by a different person;
- initial baseline approval with real separation of duties;
- logout/login continuity for both identities.

No fake JWT, same-user self-impersonation, or fabricated Auth user will be used to close these gates.

## Remaining release gates

Before a hosted release candidate:

1. invite and link a second real verified identity to one of the configured role holders;
2. execute cross-role allow/deny checks using two real sessions;
3. execute the full governed business chain on development data;
4. verify audit events and downstream report projections after each material state transition;
5. verify logout/login continuity;
6. run regression and security checks again;
7. then create one cohesive hosted release candidate for final OAuth/network/browser acceptance.

## Next allowed development scope

Development may continue with:

- role-targeted invitation UX and role-coverage diagnostics;
- deeper connector reconciliation / ambiguity handling;
- evidence-coverage diagnostics;
- measurement capture needed for currently data-insufficient outcome metrics;
- additional validation tooling.

Do not call the release production-ready until multi-user separation-of-duties and the full governed workflow have passed with real identities.
