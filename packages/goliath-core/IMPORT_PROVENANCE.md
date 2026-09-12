# Validated Goliath Core Import

## Source identity

- Archive: `GOLIATH_PROJECT_MANAGEMENT_TRACKER_2026-09-11.zip`
- Archive SHA-256: `ffee2a356c64635d19189a46e4dbb292b484cd1f7e5d05679e9b28ff46235e92`
- Package: `goliath-ai-first-control-refactor` v9.0.0
- Imported: 12 September 2026

The imported Git tree contains the source, tests, migrations, runtime scripts, package manifest and non-secret environment templates required to build and execute the regression suite. Generated `dist`, prior screenshots, review exports and historical test-output files were intentionally not imported because they are reproducible evidence rather than source.

## Reproduction

```bash
cd packages/goliath-core
npm ci --ignore-scripts
npm test
```

Verified after import:

- TypeScript build: PASS
- Tests: 236
- Passed: 236
- Failed: 0

`pg-native` installation scripts are skipped in the generic CI job. The PostgreSQL live smoke remains a separate deployment-runtime check because it requires libpq and an approved `DATABASE_URL`.
