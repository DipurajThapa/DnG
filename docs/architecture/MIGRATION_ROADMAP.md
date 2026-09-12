# Consolidation and Migration Roadmap

## Phase 0 - Freeze objectives (complete)

- North-Star architecture committed.
- Product/data/role boundaries frozen.
- Legacy David Site and current Goliath Vercel deployment retained as rollback references.

Exit: no implementation decision contradicts the North-Star without a recorded ADR.

## Phase 1 - Put the validated Goliath baseline under Git control (complete)

- Imported the exact SHA-256-verified source baseline into `packages/goliath-core`.
- Preserve migrations and automated regression evidence.
- Reproduced the complete **236/236** regression from the Git working tree.
- Kept the current production URL separate from the named-user candidate.

Exit: source identity and test baseline are reproducible from GitHub.

## Phase 2 - Reconstruct David on GitHub (partial)

- Rebuild current routes/content from saved implementation evidence.
- Implement enquiry persistence and controlled customer-status paths.
- Make `/workspace` and shared workspace CTAs target canonical Goliath admission.
- Do not claim checkout/payment/activation until their authoritative providers/contracts exist.

Exit: replacement David passes route/content/contact/link/responsive tests.

## Phase 3 - Shared identity/admission (implementation complete; acceptance pending)

- Replace persona/acting-role production behavior with authenticated named users.
- Establish organisation membership, entitlement and responsibility mappings.
- Return only permitted contexts to each user.

Exit: cross-role denial tests and multi-user acceptance pass.

## Phase 4 - Full Goliath web integration (in progress)

- Reconnect full validated UI workflows to backend/API/persistence.
- Restore guarded writes: progress, assignment, handoff, decisions, resources and admin context changes.
- Re-run cumulative role and browser acceptance.

Exit: full validated feature baseline is available at the canonical Goliath URL.

## Phase 5 - David commercial/onboarding integration (not started)

- Connect verified customer identity, commercial decision, entitlement, organisation bootstrap and Goliath admission.
- Preserve safe recovery for payment/provider/activation failures.

Exit: David -> Goliath customer lifecycle passes end to end with no invented success state.

## Phase 6 - Production hardening and cutover (started)

- monitoring/error reporting;
- rate limits and abuse protection;
- backup/restore acceptance;
- secrets/provider configuration;
- performance/load smoke;
- accessibility/responsive acceptance;
- stale URL/redirect scan;
- duplicate deployment cleanup after rollback window.

Started controls:

- `main` CI coverage for the web candidate and validated core;
- full validated-core regression in CI;
- fail-closed local-only development runtime;
- CSP aligned to the development backend;
- automatic hosted deployment disabled until a release configuration is introduced.

Exit: production checklist passes and legacy ChatGPT Site can be retired or redirected.

## Decision rule

Do not replace a working path until the replacement has demonstrated equivalent or better behavior through the affected acceptance journeys.
