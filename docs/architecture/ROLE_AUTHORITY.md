# Role and Authority Baseline

## Identity is not authority

Authentication answers **who** the user is. Authorization additionally evaluates current organisation membership, entitlement, responsibility, project/team/resource scope, workflow prerequisites and separation of duties.

A production user must never gain authority merely by selecting a role in the browser.

## Context selection

A signed-in person may have multiple legitimate responsibility contexts. The UI may let them switch only among contexts returned by the backend for that identity.

Development/test fixtures may expose broader persona switching, but write operations must still be fenced from production data.

## High-level matrix

| Role | Primary purpose | Must not inherit by default |
|---|---|---|
| Sponsor | decisions, value, material exceptions | routine assignment/update administration |
| Portfolio Manager | priorities, portfolio capacity/value | project-team execution authority |
| Program Manager | cross-project outcomes/dependencies | routine PM assignment authority |
| Project Director | authorised oversight/commercial control | enterprise identity administration |
| Project Manager | project control, coordination, forecast | functional resource-allocation authority |
| PMO / Controls | assurance, completeness, traceability | unrestricted sensitive commercial data |
| Resource Manager | functional demand/capacity/allocation | project approval/decision authority |
| Delivery Lead | team coordination | sponsor/PM governance authority |
| Agile Delivery Lead | flow/team coordination | default project assignment authority |
| Team Member | owned work/evidence/handoffs | project-wide management authority |
| Enterprise Admin | organisation/context/access administration | automatic confidential project-content access |

## Enforcement

Protected operations must perform authority checks server-side before sensitive data is returned and again when a guarded write is committed if authority may have changed concurrently.

## View-as / support

Any administrative support or diagnostic 'view as' capability must be explicit, audited and preferably read-only. It cannot silently mint business authority.
