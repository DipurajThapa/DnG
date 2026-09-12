# David + Goliath North-Star Architecture

Status: **authoritative migration baseline**

This document freezes the original product objectives before further consolidation work. Existing code, hosting and UI are implementation evidence; they are not allowed to silently redefine the product.

## 1. Product outcomes

### David
David is the vendor-facing public and customer-lifecycle application. It owns discovery, enquiries, controlled commercial selection, customer verification, entitlement/onboarding, deployment/access administration and the handoff into Goliath.

David does **not** own project execution state, project work, project finance, delivery evidence or project decisions.

### Goliath
Goliath is the project-control application. It owns the governed project baseline, commitments, evidence-backed state, material exceptions, decisions, handoffs, resources/capacity projections, project financial projections, reporting projections, traceability and closure.

Goliath does **not** become a replacement CRM, ERP, HRIS, Jira, accounting system or payment processor. External specialist systems remain authoritative for the fields they own.

## 2. Core product principles

1. **One authority per field and effective period.** Integrations reconcile facts into Goliath; they do not create parallel masters.
2. **One canonical project reality.** UI, API, reporting and automation are projections of the same governed state.
3. **Commitments, not duplicate task databases, are the control unit.** Source-system tasks remain evidence unless Goliath is the declared source of authority for that field.
4. **Plan / Evidence / Forecast remain distinct.** Forecast movement never silently changes the approved baseline.
5. **Human authority is consequence-based.** Material baseline, commercial, release, risk-acceptance and external commitments remain human-authorised.
6. **Action -> evidence -> state -> outcome remains traceable.** No checkbox-only closure for material work.
7. **Progressive setup.** A project can start after the minimum control perimeter exists; optional integrations and secondary metadata cannot block ordinary operation.
8. **Exception-driven experience.** The system should interrupt people only when their judgement, decision, approval, accountability or missing information is materially required.
9. **Server-side authorization.** Hiding a control in the UI is never security.
10. **No role impersonation as normal operation.** Production identity determines available responsibility contexts. Development-only acting-context switching cannot grant write authority.
11. **No false success.** Saved enquiry is not sent email; payment redirect is not settled payment; accepted API call is not completed external effect; missing evidence is not complete.
12. **Failure remains visible.** Stale, ambiguous, contradictory, inaccessible and unavailable states are explicit and recoverable.

## 3. Platform direction

Consolidate engineering onto:

- GitHub for version-controlled source and acceptance evidence;
- Vercel for the independently deployable David and Goliath web applications;
- Neon/PostgreSQL for transactional persistence, authentication support and controlled data APIs;
- shared packages/contracts for identity, authorization, audit, tenant context and design primitives.

This is a **shared engineering platform**, not a single mixed application.

## 4. Required deployment boundaries

- David and Goliath remain independently deployable.
- A David outage must not require a Goliath outage and vice versa.
- David commercial data is not automatically project-visible.
- Goliath project data is not automatically vendor-commercial-visible.
- Shared identity establishes who the person is; membership, entitlement, role and scope separately decide what they may do.

## 5. Data boundaries

Preferred logical separation:

- `david_*`: commercial/customer lifecycle records;
- `identity_*`: portable identity, organisation membership and admission contracts;
- `goliath_*`: project-control state;
- provider/integration facts remain linked to source identity and provenance.

Cross-boundary access is through explicit contracts/functions, not unrestricted cross-schema querying from browser clients.

## 6. Original role intent to preserve

- Project Manager: detailed project control, interventions, forecast and coordination.
- Program Manager: cross-project outcomes/dependencies; no routine PM authority.
- Portfolio Manager: portfolio priorities, capacity and value.
- Sponsor: decisions, assurance and material exceptions; no routine task administration.
- Project Director: authorised project/commercial oversight.
- PMO / Project Controls: governance, completeness, traceability and controls.
- Resource Manager: demand, capacity and allocation.
- Delivery Lead / Agile Delivery Lead: team coordination within defined authority.
- Team Member: owned work, evidence, blockers and governed handoffs.
- Enterprise Admin: organisation/configuration/access administration; not automatic confidential project-data entitlement.

## 7. Non-negotiable acceptance rule

No workflow is considered complete merely because a page renders or an HTTP request returns 2xx. Acceptance requires the intended stored state, relationship, owner, authorization, downstream projection, audit lineage and recovery behavior to be correct.

## 8. Migration rule

Preserve the previously validated full Goliath behavior. The temporary simplified Vercel UI is an acceptance bridge only and must not become the accidental product baseline.

David is reconstructed from the saved implementation evidence and current live experience because its native ChatGPT Site source is not exportable through the available interface. Legacy David remains available until the replacement passes route, workflow, data and responsive acceptance.
