# David to Goliath Entitlement and Admission Contract

Status: **contract and persistence foundation implemented; runtime integration pending**

## Decision

Use a signed, organisation-scoped entitlement envelope as the only portable commercial assertion from David to Goliath. Do not encode a user, role, permission, team or project membership in that envelope.

This preserves four independent decisions:

1. David decides whether a customer organisation has a current commercial or approved-pilot entitlement.
2. Goliath decides whether that organisation is admitted and may provision projects within its limit.
3. Organisation administrators admit named people to the organisation.
4. Project administrators assign admitted people or reusable teams to specific projects; responsibility policy decides what each person can do.

A valid entitlement therefore cannot make a person an Organisation Admin, Project Admin, Sponsor, Project Manager or Team Member.

## Signed envelope

The version 1 payload contains only:

- grant, issuer, audience and nonce identifiers;
- David organisation and customer-account identifiers;
- plan code and project limit;
- active, grace, restricted or revoked lifecycle state;
- revision, issued-at, not-before and expiry instants.

The contract uses canonical JSON and Ed25519 signatures with an explicit key ID. Goliath verifies the signature, issuer, audience, organisation binding, time window and replay state before persisting an immutable receipt.

Signing keys are server-only. Neither web application may receive a private signing key. Key rotation is handled by the protected key ID and Goliath's configured public-key trust set.

## Lifecycle policy

| Entitlement state | Organisation access mode | New project provisioning | Project authority |
|---|---|---:|---:|
| active | enabled | allowed up to limit | never granted |
| grace | grace warning | blocked | unchanged and independently evaluated |
| restricted | restricted | blocked | independently restricted by Goliath policy |
| revoked | denied | blocked | no authority can be derived from the entitlement |

The receipt history is append-only. The latest event is a projection, not a rewritten fact. Cancellation, downgrade or revocation does not delete project history.

## Persistence boundary

`platform_identity.entitlement_receipts` stores verified grant and replay evidence. `platform_identity.organisation_admission_events` stores append-only lifecycle decisions. `current_organisation_admissions` projects the latest effective (not future-scheduled) state.

Browser roles have no direct privileges on these objects. A future server-side admission service must verify and persist the receipt and nonce in one transaction, then append the corresponding admission event. Verification alone is intentionally side-effect free.

These objects do not write to:

- `organisation_memberships`;
- `pc_project_memberships`;
- `ec_team_memberships` or `pc_project_team_assignments`;
- `ec_responsibility_assignments` or `ec_responsibility_sources`.

## Remaining runtime work

1. Add a server-side David issuer backed by managed Ed25519 keys.
2. Add a server-side Goliath verifier/consumer with atomic receipt and nonce persistence.
3. Map an admitted David organisation to a governed Goliath organisation through an authorised onboarding action.
4. Apply current admission state to organisation provisioning and lifecycle policy without bypassing project authorization.
5. Exercise active, grace, restricted, revoked, expired, tampered and replayed envelopes end to end.
