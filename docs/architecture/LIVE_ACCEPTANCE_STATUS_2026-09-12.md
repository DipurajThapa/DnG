# Live Named-User Acceptance Status

Checked: **12 September 2026**

Environment: **Neon `goliath-development` branch, read-only verification**

## Verified state

| Check | Status | Evidence |
|---|---|---|
| Sponsor identity linked | PASS | Active identity link resolves to a Sponsor responsibility on Project Alpha and Goliath Product Development. |
| Team Member identity linked | PASS | Active identity link resolves to a Team Member responsibility on Provider Runtime Project (F5). |
| Distinct people | PASS | Sponsor and Team Member use distinct authentication subjects and distinct Goliath user identities. |
| Scope isolation | PASS | Team Member access remains scoped to F5 and was not widened to the Sponsor's project. |
| Supported role configuration | PASS | All 12 catalog roles now cover Goliath Product Development; the added Project Admin fixture is unlinked and development-only. |
| Sponsor access probe | BLOCKED | No persisted `identity.acceptance.probed` event exists from the Sponsor session. |
| Team Member access probe | BLOCKED | No persisted `identity.acceptance.probed` event exists from the Team Member session. |
| Sponsor workflow input | PARTIAL | Goliath Product Development has 14 proposed commitment candidates and a linked Project Manager, but no candidate has yet been confirmed as a governed commitment. |
| Team Member owned work | BLOCKED | F5 has no active governed commitment and none assigned to the Team Member. |
| F5 Project Manager identity | BLOCKED | The F5 Project Manager responsibility is still an unlinked fixture identity. |

## Interpretation

Invitation and initial login are no longer blockers. Cross-role acceptance is still incomplete because login does not itself prove the session-bound allow/deny boundary or a persisted governed workflow.

The Sponsor and Team Member are intentionally on different projects. This correctly proves that organisation membership must not widen project scope, but it means one shared-project scenario cannot be inferred from these accounts.

## Next governed actions

1. Sponsor signs in and runs **Access check**; confirm the audit event persists.
2. Team Member signs in and runs **Access check**; confirm the audit event persists.
3. Link a real authorised Project Manager to F5 or assign the Team Member governed work from another correctly scoped Project Manager context.
4. The Project Manager confirms a real commitment candidate with evidence criteria and assigns one commitment to the Team Member through the application.
5. Run UI -> authentication -> authorization -> API -> database -> refreshed UI -> audit -> logout/login persistence.

Do not seed a passing probe, fabricate a commitment or widen the Team Member to the Sponsor's project merely to clear a gate.
