# Goliath Development Acceptance — 12 September 2026

**Implementation branch:** `main` (single retained branch)
**Development database:** Neon `goliath-development` (`br-cool-field-aupbzqgf`)  
**Production deployment touched:** No  
**Main code baseline:** governance, scoped access and multi-user acceptance work merged
**Hosted candidate enabled:** No; `apps/goliath` is fail-closed and automatic deployment is disabled

## Decision

**Structural / contract acceptance: PASS**  
**First real named-user Google sign-in: PASS**  
**Sponsor and Team Member identity/link acceptance: PASS**
**Session-bound cross-role probes: READY, awaiting execution by both real users**
**David -> Goliath entitlement contract foundation: PASS; runtime integration pending**
**Production release decision: NOT READY**

This record covers the off-Vercel development environment only. It must not be used as evidence that a hosted production OAuth/browser journey has passed acceptance.

## Source reproducibility

PASS:

- the original source archive SHA-256 matches `ffee2a356c64635d19189a46e4dbb292b484cd1f7e5d05679e9b28ff46235e92`;
- source, tests, migrations and scripts are present under `packages/goliath-core`;
- TypeScript builds from the Git working tree;
- the complete regression was rerun from that directory: **236 tests, 236 passed, 0 failed**.

This closes the repository reproducibility gap. It does not close browser, database-binding or real-user acceptance for the newer Neon web candidate.

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

PASS for the two newly invited real identities:

- `jarupid.apaht@gmail.com` is email-verified, actively linked to governed user `bob`, and resolves Sponsor responsibilities for projects `A` and `GOLIATH-DEV`;
- `thenewrules101@gmail.com` is email-verified, actively linked to governed user `f5-dev`, and resolves the Team Member responsibility for project `F5` / team `dev`;
- the two accounts resolve to different Auth subjects and different governed users;
- their project scopes remain deliberately different. The Team Member has not been widened to `GOLIATH-DEV` merely to simplify acceptance.

The invitation and login dependency is therefore closed. What remains is evidence from each account's own authenticated browser session that its allow/deny boundaries behave as configured and persist to the audit ledger.

## Role model / coverage

The supported role model is now centralised in `platform_identity.role_catalog` rather than being defined only by scattered UI conditionals.

Canonical supported roles:

1. Enterprise Admin
2. Portfolio Manager
3. Program Manager
4. Project Director
5. Project Admin
6. Project Manager
7. PMO / Project Controls
8. Resource Manager
9. Delivery Lead
10. Agile Delivery Lead
11. Team Member
12. Sponsor

For `GOLIATH-DEV`, all 12 roles now have at least one effective governed responsibility that covers the project through the appropriate project/program/portfolio/organisation/org-unit scope.

Enterprise Admin, Project Manager, Sponsor and Team Member now have linked real Auth identities. The other configured role holders remain deliberately unlinked; configuration coverage is not treated as proof of a real-user journey.

The UI now distinguishes:

- **My responsibilities** — only responsibilities actually assigned to the signed-in identity;
- **Role coverage** — Enterprise Admin visibility of all supported roles, scopes, project coverage and linked-identity readiness.

No arbitrary production-style role impersonation has been reintroduced.

## Main-branch CI

The workflow now runs for relevant pushes and pull requests to `main`, and may be run manually. It validates:

- JavaScript syntax for core, governance, PMO-control and role-model UI modules;
- local-only development runtime configuration and approved origins;
- development CSP/backend alignment;
- automatic Vercel deployment disabled for `main` while the candidate is not release-ready;
- product-direction guardrails;
- required migration set;
- governance UI action contracts;
- baseline immutability migration;
- integration/outcome instrumentation contracts;
- legacy anonymous/public RPC lockdown;
- canonical role catalog and development role-coverage seed;
- integrated development contract checks;
- multi-user acceptance RPC/UI contracts and deployable JavaScript asset routing;
- installation, TypeScript build and all 236 validated-core regression tests.
- the Ed25519 entitlement contract's signature, temporal, audience, replay, lifecycle and authority-field boundaries.

## David -> Goliath entitlement boundary

PASS at contract and persistence-foundation level:

- canonical organisation-scoped payloads are signed with Ed25519 and an explicit rotation key ID;
- verification binds issuer, audience, organisation and validity window;
- grant ID and nonce replay checks fail closed;
- active, grace, restricted and revoked states map to explicit organisation admission modes;
- role, permission, user, team and project-membership fields are rejected;
- verification never grants project or individual authority;
- verified receipts and organisation-admission events have an append-only migration with browser access revoked;
- the migration was applied successfully to the isolated `acceptance-probe-verify-20260912` branch and the resulting objects, triggers, future-event filter and browser-denial privileges were inspected.

Still pending: a server-side David issuer, managed signing keys, atomic Goliath verification/receipt consumption, organisation mapping and hosted lifecycle acceptance. The migration has not been applied to `goliath-development` or production.

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

## Multi-user acceptance increment

The development candidate now includes a session-bound `Run access check` action backed by `goliath_api.run_role_acceptance_probe(assignment)`.

For the currently authenticated identity and selected responsibility, the probe checks:

- Auth identity to governed-user and responsibility binding;
- the role-required navigation surface;
- exclusion of a same-organisation project outside the responsibility scope, where one exists;
- Enterprise Admin access allowed only for Enterprise Admin;
- Project Cockpit management access allowed only for the governing delivery-control roles;
- durable persistence of the result in `platform_identity.audit_events` as `identity.acceptance.probed`.

It does not mutate commitments, tasks, baselines, decisions or project scope. Enterprise Admin also receives a `multi_user_acceptance_readiness` projection showing Sponsor/Team Member linkage, distinct Auth subjects and whether both audited probes have passed. If the Team Member is on another project, the UI says so explicitly rather than implying selected-project coverage.

The projection separates two decisions:

- `readyForRoleBoundaryAcceptance` requires the two distinct real identities and their successful audited probes;
- `readyForGovernedWorkflow` additionally requires a linked Project Manager and a real candidate/commitment for the Sponsor project, plus at least one governed commitment owned by the Team Member inside the Team Member's assigned scope.

Current prerequisite state:

- `GOLIATH-DEV` has a linked Project Manager and 14 proposed candidates, so the PM-to-Sponsor workflow can be started through governed UI actions;
- `F5` has a linked Team Member but no governed commitment owned by that user. A Project Manager must create or confirm and assign one through the application before a genuine Team Member update/persistence journey can pass;
- F5 Project Manager `F5-PM` is configured but not linked to a real Auth identity. This remains a positive-workflow setup gap, not an invitation/login blocker for the Team Member.

### Real-session cross-role acceptance — READY / PENDING EXECUTION

Still unverified:

- Sponsor probe executed from `jarupid.apaht@gmail.com` with the Sponsor responsibility selected;
- Team Member probe executed from `thenewrules101@gmail.com` with the Team Member responsibility selected;
- logout/login continuity for both identities;
- Sponsor positive decision/report journey within the Sponsor's project scope;
- Team Member positive owned-work/evidence journey within `F5`;
- linked/authorised Project Manager preparation of one Team Member-owned governed commitment in `F5`;
- named decision or baseline approval by a different authorised person;
- downstream report and audit projection after a governed state transition.

No fake JWT, same-user self-impersonation, scope widening or fabricated Auth user will be used to close these gates.

## Remaining release gates

Before a hosted release candidate:

1. execute the session-bound allow/deny probe from the Sponsor and Team Member accounts;
2. execute permitted Sponsor and Team Member journeys inside each account's actual project scope;
3. execute the full governed business chain on development data with separate submitter and approver;
4. verify audit events and downstream report projections after each material state transition;
5. verify logout/login continuity;
6. run regression and security checks again;
7. introduce an explicit hosted release runtime rather than promoting the development configuration;
8. create one cohesive hosted release candidate for final OAuth/network/browser acceptance.

## Next allowed development scope

Development may continue with:

- role-targeted invitation UX and role-coverage diagnostics;
- deeper connector reconciliation / ambiguity handling;
- evidence-coverage diagnostics;
- measurement capture needed for currently data-insufficient outcome metrics;
- additional validation tooling.

Do not call the release production-ready until multi-user separation-of-duties and the full governed workflow have passed with real identities.
