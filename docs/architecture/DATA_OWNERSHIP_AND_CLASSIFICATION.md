# Goliath Data Ownership, Provenance and Classification

**Status:** Development control baseline  
**Date:** 12 September 2026

## Governing rule

Goliath uses **one authoritative system of record per field**. It does not copy external operational data merely to make reporting convenient.

Examples:

- task/work-item status, assignee, sprint and story points -> execution system;
- code, PR, build and deployment events -> Git/CI/CD;
- people master, leave and contract data -> HRIS;
- approved effort actuals -> designated timesheet/PSA authority;
- posted cost, invoices and revenue -> ERP/finance;
- commitments, decisions, dependencies, RAID, changes, baselines, evidence links, report snapshots and audit -> Goliath;
- health and forecasts -> Goliath-derived values over governed evidence.

The active registry is stored in `pc_field_ownership_rules` and is available to authenticated Goliath users only through the governed API projection.

## Evidence contract

A Goliath evidence link preserves, where applicable:

- source system;
- source object type and identifier;
- source URL;
- owner system;
- source version;
- source update time;
- ingestion time;
- last reconciliation time;
- mapping version;
- freshness state;
- lifecycle state;
- ingestion mode;
- data class;
- origin.

Goliath owns the evidence-link/provenance record. It does **not** become the authority for the external evidence value.

## Data classes

The current foundation recognises:

- `delivery`
- `financial-cost`
- `financial-billing`
- `hr`
- `client-confidential`
- `audit`

Data-class access is separate from project membership and responsibility role.

The authorization model remains:

`identity -> responsibility role/scope -> object/action permission -> data class`

An allowed data class does not itself allow an object mutation. Existing write RPCs must still enforce their own role, scope, object and workflow-state rules.

## Default posture

Normal delivery roles receive only `delivery` access unless a deliberate default is required for their function.

Current exceptions:

- Resource Manager: `hr` read access for authorised capacity/availability information.
- Enterprise Admin: `audit` read access; administration authority does not automatically grant project-delivery visibility.

No role receives default `financial-cost`, `financial-billing` or `client-confidential` access.

Those classes require an explicit, reasoned, audited responsibility-level override.

## Overrides

Explicit overrides are stored in `ec_data_class_overrides` and are governed through `admin_set_data_class_override`.

Rules:

- Enterprise Admin responsibility required;
- named active target responsibility required;
- write requires read;
- meaningful reason required;
- previous active override for the same assignment/class is closed before a replacement is recorded;
- change is appended to the context audit ledger.

## Derived-data rule

A derived value must never reveal restricted inputs simply because the output itself looks harmless.

Target rule:

> a derived value inherits the highest data class of its inputs unless an explicitly governed declassification rule exists.

For health specifically, the preferred pattern is to compute dimensions independently and roll up only dimensions the viewer is permitted to see. The UI should label the result `partial` when restricted dimensions are omitted.

The current `commitment_evidence_projection` establishes the first implementation boundary: evidence outside the viewer's data classes is not returned. The projection may state that the visible result is partial, but it does not return hidden evidence details.

## Public/API boundary

The new ownership/classification tables have no direct grants to browser-facing roles.

Authenticated application access is through `goliath_api` functions. Anonymous and `goliath_web_anon` execution is denied for the new governed functions.

## Development acceptance

This slice is accepted only when:

- ownership registry exists and is versioned;
- restricted classes are deny-by-default;
- direct browser/table grants are absent;
- evidence projection filters by data class server-side;
- Enterprise Admin override workflow is audited;
- production/integration branch remains unchanged;
- Vercel is not used for inner-loop development.
