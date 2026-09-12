# Goliath validated source baseline

This directory anchors the consolidated GitHub/Vercel/Neon migration to the last fully validated Goliath application rather than treating the temporary hosted bridge as the product baseline.

## Exact source package

- Original release: `GOLIATH_PROJECT_MANAGEMENT_TRACKER_2026-09-11.zip`
- SHA-256: `ffee2a356c64635d19189a46e4dbb292b484cd1f7e5d05679e9b28ff46235e92`
- Package identity: `goliath-ai-first-control-refactor` v9.0.0
- Canonical schema at that baseline: 43 business tables

A development-core archive containing `src/`, `tests/`, `migrations/`, `scripts/` and build/runtime configuration was also created during consolidation:

- `goliath_validated_core_20260911.tar.gz`
- SHA-256: `fe8b0232b082c2dfeb17269fdfe5b52af984b35569779536d73fd66867bdf768`

The complete original source archive is retained in the project artifact library while the canonical source tree is progressively imported under this repository.

## Fresh regression rerun — 12 September 2026

Command:

```bash
npm test
```

Result:

- TypeScript build: PASS
- Tests: **236**
- Passed: **236**
- Failed: **0**
- Cancelled: **0**
- Skipped: **0**
- Todo: **0**

The rerun includes the final user-directory tests:

1. Enterprise Admin receives the complete organisation user directory, including roster-only users — PASS.
2. Non-admin roles cannot retrieve the organisation user directory — PASS.
3. Runtime UI exposes project-team/admin directory and all supported responsibility roles — PASS.

## Migration rule

The hosted named-user implementation must preserve these domain invariants and role boundaries. A passing Vercel deployment is not allowed to redefine product truth, role authority, project workflow or data ownership simply because the hosting architecture changed.

Any new GitHub/Vercel/Neon workflow is accepted only when it either delegates to the validated behavior or proves equivalent behavior through explicit regression and denial tests.
