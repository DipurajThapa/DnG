# Goliath Current-vs-Target Gap Matrix

**Status:** Architecture control baseline before further feature development  
**Date:** 12 September 2026  
**Governing sources:** `Goliath — Product and Operating Blueprint v0.9` and `AI-First Project Management — Redesign Checklist`

Classification values:

- **KEEP** — aligned and useful foundation.
- **REWORK** — useful implementation exists but the product/domain semantics must change.
- **MERGE** — overlapping concepts should become one governed model/workflow.
- **REMOVE** — should not remain part of the target product path.
- **MISSING** — required capability/model is not meaningfully present.
- **DEFER** — valid target capability, deliberately outside the current MVP phase.

## Executive conclusion

The current implementation has useful platform foundations but is still too activity/task-centric. The primary correction is not a UI redesign. The domain and product-control model must move toward **Commitment + Evidence + Decision Intelligence**, while external execution systems continue to own detailed tasks and operational records.

Traditional PM outputs remain supported as reporting projections and must not drive the domain model.

| Area | Current state | Classification | Target / action | Phase |
|---|---|---|---|---|
| Tenant / organisation context | Organisation, portfolio, program, project context foundations exist | KEEP | Preserve and harden tenancy/isolation | Foundation |
| Named-user identity | Google/Neon named-user direction and explicit identity links exist | KEEP / REWORK | Preserve server-resolved identity; evolve toward enterprise OIDC/SAML/SCIM/MFA | Foundation |
| Responsibility model | Role + scope assignments and governed grant/revoke exist | KEEP / REWORK | Extend to object type, data class and action; preserve server-side enforcement | Foundation |
| Enterprise Admin | Identity/responsibility administration exists | KEEP / REWORK | Keep admin separate from project execution; add access explorer, connector/entitlement/audit controls later | Foundation/MVP |
| Activity/task model | `pc_activities` is currently central to project experience | REWORK | Activities become execution evidence/serving work; do not remain permanent management root | MVP |
| Workstream | No proper methodology-aware workstream domain | MISSING | Add workstreams with Agile/Waterfall/Hybrid methodology and project association | MVP |
| Commitment | Not the true management root | MISSING / REWORK | Add first-class commitment with owner, consumer, committed date, forecast, acceptance criteria and evidence spec | MVP |
| Evidence/provenance | Source/freshness concepts exist but no complete evidence graph | REWORK | Add governed evidence links, owner system, timestamps, mapping version, freshness, classification and lifecycle | Foundation/MVP |
| Per-field system-of-record | Partly documented, not fully implemented | REWORK | Explicit field ownership; external execution/ERP/HR fields remain authoritative outside Goliath | Foundation |
| Commercial baseline / SOW | Project shell exists; commercial baseline is not a first-class object | MISSING | Structured baseline manually entered for MVP; extraction later | MVP/P2 |
| Requirements | Not meaningfully implemented as first-class linked objects | MISSING | Requirement lifecycle + typed links + live coverage | MVP |
| Baseline / versioning | Some baseline/governance concepts exist | REWORK | Baseline must version commitments/scope/schedule and preserve approved diffs | MVP |
| Change Request | Partial change/baseline controls only | REWORK | One-action CR, manual impact MVP, threshold routing, latency and approved re-baseline | MVP |
| Decision | Decision table/RPC primitives exist | REWORK | Full decision object, decider queue, needed-by, impact-if-late, rationale, latency and decision debt | MVP |
| Dependency | Mainly activity-to-activity | REWORK | Two-party commitment semantics: provider, consumer, promised, needed-by, acceptance, acknowledgement, slip history | MVP |
| RAID | Blockers/attention exist but not governed linked RAID model | MISSING / MERGE | Risks/issues/assumptions linked to commitments; watched deterministic triggers where possible | MVP |
| Health | Task/project summaries exist, no target computed health | MISSING | Four MVP dimensions: schedule, dependencies, decisions, delivery progress; cause + data-insufficient state; shadow mode | MVP |
| PM assessment | Not a first-class parallel layer to computed health | MISSING | Store PM assessment and divergence without replacing computed state | MVP |
| Evidence coverage | Not a first-class governed measure | MISSING | Evidence-spec-based coverage, not linked-record-count-based coverage | MVP |
| Capacity | Resource/demand/allocation primitives exist | REWORK | Cross-project capacity ledger, availability, bookings, conflicts, ceiling/concurrency warnings | MVP/P2 |
| People monitoring | No deliberate target policy in product runtime | KEEP boundary | Explicitly prohibit individual productivity inference; only legitimate load/continuity use | Foundation |
| Rate card / planned cost | Finance placeholders exist but source depth is insufficient | REWORK | MVP only: versioned/imported rate card + bookings -> planned cost; no fabricated actual/margin/EAC | MVP |
| Actual/posted finance | No authoritative connected source | DEFER | Timesheet/PSA/ERP integration, reconciliation, actual/posted/forecast economics | P2/P3 |
| Project reporting | Some summaries/snapshots exist | REWORK | Capture once, render by audience, snapshot on distribution, source/evidence traceability | MVP |
| Gantt / burnup / burndown | Not core domain capability | KEEP as projection / DEFER | Methodology-aware reporting from authoritative plan/work evidence; never a parallel truth | MVP when data permits |
| PMO experience | Broad oversight rather than evidence/calibration focus | REWORK | Evidence coverage, integration health, data quality, shadow health and later calibration/noise | MVP/P2 |
| Project Manager experience | Task/control oriented | REWORK | Project Cockpit: what changed, risk/cause, decisions, dependencies, evidence and intervention | MVP |
| Program Manager | Mostly roll-up/filtering | REWORK | Program dependency/decision/escalation projection over shared model | MVP-lite/P2 |
| Portfolio Manager | Mostly project list/summary | DEFER / REWORK | MVP list of at-risk commitments/decision debt; scenarios/concentration later | MVP-lite/P2 |
| Sponsor / decider | Some project visibility and decision resolution | REWORK | Decision Queue first; consequences/evidence before project detail | MVP |
| Team member | Activity/task list | REWORK | My Commitments + serving tasks/evidence, dependencies and required actions | MVP |
| Resource Manager | Partial resource-demand view | REWORK | Capacity Desk over single ledger, not project execution views | MVP |
| Notifications | No full responsibility/time model | MISSING | Actionable responsibility-driven notifications, bundling, acknowledgement, escalation clock, de-escalation | MVP |
| Escalation | Partial workflow concepts | MISSING | Escalate commitment, not person; severity x impact x duration; internal path; external escalation human-controlled | MVP |
| Audit | Hash-chained project/context write events exist for part of hosted path | KEEP / REWORK | Extend coverage to auth, sensitive reads, approvals, overrides, AI, entitlements, connectors and exports | Foundation/P2 |
| Data-class authorization | Some finance stripping implemented, no general class engine | MISSING | Delivery, financial-cost, financial-billing, HR, client-confidential, audit grants and derived-data classification | Foundation |
| Derived-data security | Manual role-specific stripping exists | REWORK | Computed values inherit highest input class or are recomputed from viewer-permitted dimensions | Foundation |
| Integration framework | Excel/CSV and architecture concepts exist; live connector backbone incomplete | REWORK / MISSING | Webhook + delta + reconcile, mapping, freshness, ambiguity queue, rate budgets, explicit write-back policy | Foundation/MVP |
| Client-owned tracker support | Not implemented | MISSING | Delegated OAuth / scheduled export / client-approved app, with coverage ceiling | MVP |
| AI provenance/governance | Design exists; implementation incomplete | MISSING / DEFER | Origin, sources, confidence, model version, human disposition, evaluation; MVP only for selected assistive use | Foundation/MVP |
| AI autonomous PM | Not required | REMOVE | Never make scope/budget/staffing/baseline/client decisions autonomously | Permanent boundary |
| Weekly status reporting | Partial | REWORK | One governed weekly snapshot with cited facts; traditional layout is a rendering | MVP |
| Client reporting | No complete target workflow | DEFER / design now | Filter same governed state; client-visible flags and no internal sensitive detail | P2 |
| Report period/history | Partial snapshots only | REWORK | Current/WTD/MTD/custom projections plus immutable distributed snapshot/evidence versions | MVP/P2 |
| David -> Goliath URL | Current handoff/link exists conceptually | REWORK | Replace URL-only trust with signed entitlement contract and organisation provisioning | Foundation |
| Entitlement lifecycle | Not implemented end-to-end | MISSING | Active/warning/grace/restricted/retention/deleted + local signed grant enforcement | Foundation |
| Customer-managed deployment | Architectural idea only | DEFER | Single supported private topology much later | P3 |
| Benefits | Not implemented | DEFER | Post-closure benefit objects and measurement | P3 |
| Organisational memory | Not implemented | DEFER | Permissioned/contract-aware aggregate learning | P3 |
| Ask Goliath | Not implemented | DEFER | Cited, permission-aware conversational access | P2 |
| Outcome measurement | Not systematically instrumented | MISSING | M1, M2, M3, M4, M6, M8, M9, M11, M12, M13 first | Foundation/MVP |

## Immediate development order

1. **Domain correction:** introduce Workstream, Commitment and Evidence as first-class concepts without deleting existing activity history.
2. **Field ownership/provenance:** establish explicit evidence and source ownership contracts.
3. **Authorization:** define data classes and derived-data rules before richer health/reporting is added.
4. **Decision/dependency semantics:** upgrade existing primitives to the MVP objects defined in the blueprint.
5. **MVP health:** four dimensions, cause, data-insufficient and shadow mode.
6. **Project Cockpit / My Commitments / Decision Queue:** rebuild user experience around management attention, not record browsing.
7. **Reporting:** conventional PM outputs rendered from the governed model.
8. **Notifications/escalation:** only after responsibilities, health and dependencies have stable semantics.
9. **Capacity/planned cost:** use authoritative availability/rate data only.
10. **Hosted release candidate:** only after local/dev acceptance is cohesive.

## Non-negotiable guardrails

- Do not promote every task/activity into a commitment. Brownfield/import onboarding should create **candidates**, with milestone/outcome granularity measured in tens per project, not hundreds.
- Do not invent financial actuals, margin, forecast confidence or risk probabilities to fill a dashboard.
- Do not let traditional reporting artifacts define the canonical data model.
- Do not create separate client/leadership/PM status datasets.
- Do not use UI hiding as authorization.
- Do not silently change an approved baseline to simplify implementation.
- Do not add AI actions that can mutate scope, budget, baseline, staffing, external communication or project prioritisation without named human authority.
