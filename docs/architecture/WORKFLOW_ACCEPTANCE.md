# Workflow and Acceptance Baseline

## A. David customer lifecycle

Target journey:

`Explore -> enquire/select -> verify named customer -> commercial decision -> entitlement -> organisation bootstrap -> identity/domain setup -> membership/access -> Goliath admission -> ongoing billing/deployment/support`

Rules:

- enquiry receipt is not an order;
- order acceptance is not payment settlement;
- payment settlement is not organisation admission;
- domain match is eligibility evidence, not membership;
- organisation admin is not automatically authorised for confidential project content;
- cancellation/downgrade never deletes customer project history;
- retries reconcile the original customer/order/installation rather than creating parallel records.

## B. Goliath operating loop

Target user experience:

`Establish control -> observe/reconcile evidence -> detect material change -> route management item -> judgement/decision/action -> observe outcome -> update state/forecast -> close or continue`

The internal implementation may contain more stages, but the user must not maintain duplicate risk, action, report and decision records for the same underlying issue.

## C. Required Goliath journeys

Every release must exercise at least:

1. PM establishes a project, baseline and authorised evidence source.
2. PM sees material exceptions and can act within authority.
3. Team Member updates owned work with completion evidence.
4. Delivery Lead coordinates team work without receiving unauthorised PM powers.
5. Cross-team handoff reaches the correct receiver and can be accepted/returned with lineage.
6. Resource demand raised by PM is allocated/released by Resource Manager and reflected back in project capacity.
7. Sponsor receives decision/material-exception views without routine assignment authority.
8. Program/Portfolio/PMO aggregate views do not leak or inherit stale project context.
9. Finance uses one canonical fact set with role-specific visibility.
10. Enterprise Admin can administer contextual responsibility without gaining implicit project confidentiality.
11. Source unavailability preserves last-known truth and visibly reduces confidence/freshness.
12. AI/provider failure does not stop deterministic project control.
13. Project closure requires explicit disposition of unresolved commitments/decisions/actions and retains history.

## D. Acceptance dimensions for every workflow

A journey passes only when all applicable dimensions pass:

- UI state and navigation;
- API response and error semantics;
- server-side authorization;
- canonical stored state;
- relationship integrity;
- audit/correlation lineage;
- downstream projections/reports;
- cross-user propagation;
- retry/idempotency;
- error/recovery route;
- responsive/accessibility smoke;
- no dead end or orphan transition.

## E. Dead-end definition

A dead end exists when a user is shown a required state/action but has no authorised route to:

- complete it;
- correct missing/invalid input;
- delegate/escalate it;
- explicitly defer it under policy;
- understand why it cannot proceed.

Dead ends are release-blocking when they affect a required lifecycle or role journey.
