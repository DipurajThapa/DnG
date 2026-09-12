# Role and Authority Baseline

## Identity is not authority

Authentication answers **who** the user is. Authorization additionally evaluates current organisation membership, entitlement, responsibility, project/team/resource scope, workflow prerequisites and separation of duties.

A production user must never gain authority merely by selecting a role in the browser.

## Context selection

A signed-in person may have multiple legitimate responsibility contexts. The UI may let them switch only among contexts returned by the backend for that identity.

Development/test fixtures may expose broader persona switching, but write operations must still be fenced from production data.

## Membership and assignment model

The administration journey is `organisation onboarding -> organisation administration -> project administration -> team/project assignment -> individual access`. It is not an authority-inheritance chain.

- `organisation_memberships` is the admission boundary. Membership does not imply access to project content.
- `project_memberships` records participation without duplicating permission policy.
- `teams` and `team_memberships` are organisation-owned and reusable across projects.
- `project_team_assignments` shares a team with one or more projects without changing the team roster.
- `responsibility_assignments` remains the effective scoped access context. `responsibility_sources` records whether access is direct, inherited through a team/project assignment, or retained from the legacy model.

Removing one source does not remove access supported by another active source. A person may hold different responsibilities in different projects and may belong to more than one team.

## High-level matrix

| Role | Primary purpose | Must not inherit by default |
|---|---|---|
| Sponsor | decisions, value, material exceptions | routine assignment/update administration |
| Portfolio Manager | priorities, portfolio capacity/value | project-team execution authority |
| Program Manager | cross-project outcomes/dependencies | routine PM assignment authority |
| Project Director | authorised oversight/commercial control | enterprise identity administration |
| Project Manager | project control, coordination, forecast | functional resource-allocation authority |
| Project Admin | project membership, team assignment and project-scoped access | organisation administration or project-delivery visibility |
| PMO / Controls | assurance, completeness, traceability | unrestricted sensitive commercial data |
| Resource Manager | functional demand/capacity/allocation | project approval/decision authority |
| Delivery Lead | team coordination | sponsor/PM governance authority |
| Agile Delivery Lead | flow/team coordination | default project assignment authority |
| Team Member | owned work/evidence/handoffs | project-wide management authority |
| Enterprise Admin | organisation/context/access administration | automatic confidential project-content access |

`Enterprise Admin` is the compatibility key for the Organisation Admin role. Its authority must be constrained to its organisation. Project Admin authority must be constrained to one project and may not appoint another Project Admin.

## Enforcement

Protected operations must perform authority checks server-side before sensitive data is returned and again when a guarded write is committed if authority may have changed concurrently.

## View-as / support

Any administrative support or diagnostic 'view as' capability must be explicit, audited and preferably read-only. It cannot silently mint business authority.
