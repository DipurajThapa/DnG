# Goliath Current-vs-Target Gap Matrix

**Status:** Current implementation control record
**Updated:** 12 September 2026, after branch consolidation
**Governing sources:** `Goliath — Product and Operating Blueprint v0.9` and `AI-First Project Management — Redesign Checklist`

## Decision

The product is aligned to **Commitment + Evidence + Decision Intelligence**. The main remaining risk is no longer the absence of the target concepts; it is proving that the connected browser, API, authorization, persistence, audit and reporting workflow behaves correctly for separate real users.

Status values:

- **IMPLEMENTED** — code and database foundation are present and covered by repository checks.
- **PARTIAL** — a useful implementation exists, but a release or product requirement remains open.
- **PENDING ACCEPTANCE** — implementation exists but has not passed the required real-user or hosted test.
- **MISSING** — the required capability is not implemented end to end.
- **DEFERRED** — intentionally outside the current MVP.

| Capability | Current status | Material remaining work |
|---|---|---|
| Organisation membership | IMPLEMENTED | Prove tenant denial with independent sessions and production-like data. |
| Project administration | IMPLEMENTED | Complete Project Admin real-user acceptance. Administration must not imply delivery visibility. |
| Reusable teams | IMPLEMENTED | Validate add, replace, revoke and overlapping direct/team access through UI and audit. |
| Cross-project user assignment | IMPLEMENTED | Validate one user holding different roles in different projects. |
| Identity-bound responsibilities | PENDING ACCEPTANCE | Sponsor and Team Member probes must be executed from their own sessions. |
| Data-class authorization | IMPLEMENTED | Add live denial coverage for financial, HR, client-confidential and audit data. |
| Workstreams | IMPLEMENTED | Confirm methodology through a governed Project Manager journey. |
| Commitment as management root | IMPLEMENTED | Convert real candidates and activate commitments with evidence specifications. |
| Evidence and provenance | IMPLEMENTED | Exercise authoritative evidence updates, freshness and reconciliation exceptions. |
| Field system-of-record rules | IMPLEMENTED | Validate real connector/import ownership conflicts. |
| Requirements and traceability | IMPLEMENTED | Run one requirement through baseline, link and evidence-backed acceptance. |
| Decisions and decision debt | IMPLEMENTED | Run Sponsor decision resolution and confirm downstream latency/report updates. |
| Two-party dependencies | IMPLEMENTED | Validate provider/consumer acknowledgements and slip history with separate users. |
| RAID and deterministic triggers | IMPLEMENTED | Exercise watched trigger to human-confirmed issue conversion. |
| Immutable baseline and change | IMPLEMENTED | Complete separate submitter/approver acceptance and applied baseline delta. |
| Four-dimension health | IMPLEMENTED | Populate governed commitments/evidence and validate data-insufficient and divergence behavior. |
| PM assessment divergence | IMPLEMENTED | Exercise PM assessment alongside computed health. |
| Notifications and escalation | IMPLEMENTED | Validate acknowledge, snooze, resolve, bundling and external human boundary. |
| Capacity and planned cost | PARTIAL | Authoritative availability/rate data is still needed. Actuals, margin and EAC remain out of scope without an ERP/PSA source. |
| Role-specific experiences | IMPLEMENTED | Browser acceptance remains required for all materially different roles. |
| Governed reports and snapshots | IMPLEMENTED | Validate snapshot persistence and audit after a real state transition. |
| Outcome instrumentation | PARTIAL | M1, M4, M8, M9 and M12 surfaces exist. M2, M3, M6, M11 and M13 require governed evidence. |
| Integration/reconciliation framework | PARTIAL | Foundations exist; real connector credentials, reconciliation and read-back remain environment work. |
| AI provenance and governed assistance | PARTIAL | The validated core has deterministic/assistive controls; the hosted candidate still needs approved provider binding and real evaluation data. |
| Validated core in Git | IMPLEMENTED | Exact archive hash verified and 236/236 tests reproduced from `packages/goliath-core`. |
| Development runtime isolation | IMPLEMENTED | Local origins only; automatic Vercel deployment is disabled until an explicit release candidate. |
| David entitlement/admission contract | MISSING | Replace URL-only handoff with signed entitlement, organisation provisioning and lifecycle enforcement. |
| Hosted production acceptance | PENDING ACCEPTANCE | Configure a dedicated release runtime, OAuth/CORS/CSP, execute E2E, then promote. |
| Design-partner outcome proof | MISSING | Run three tenants and collect the blueprint's M1–M13 evidence over the required period. |
| Client reporting, Ask Goliath, benefits and organisational memory | DEFERRED | Preserve authorization/provenance design hooks; do not expand MVP breadth yet. |

## Immediate delivery order

1. Keep the named-user candidate fail closed outside approved local origins.
2. Protect `main` with static, contract and full validated-core regression checks.
3. Execute Sponsor and Team Member session-bound allow/deny probes.
4. Create one Team Member-owned commitment in `F5` through an authorised Project Manager.
5. Run the complete governed chain: UI -> authentication -> authorization -> API -> persistence -> audit -> report -> logout/login.
6. Implement David's signed entitlement and organisation-provisioning contract.
7. Prepare a dedicated hosted release configuration; never reuse development runtime settings for production.

## Non-negotiable guardrails

- Organisation administration does not grant project delivery access.
- Project roles are scoped to their project unless a separate responsibility explicitly covers more.
- Team membership and project assignment remain separate relationships.
- Removing one access source must not remove access supported by another active source.
- Approved baselines are append-only and cannot be silently rewritten.
- No unsupported actual cost, margin, EAC, health certainty or outcome metric is fabricated.
- UI hiding is never treated as authorization.
- AI cannot make consequential scope, budget, staffing, baseline, client-communication or prioritisation decisions without named human authority.
