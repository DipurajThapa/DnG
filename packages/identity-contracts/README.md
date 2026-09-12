# DnG identity contracts

This package defines the signed, organisation-scoped entitlement envelope used for the David to Goliath admission boundary.

It deliberately carries no user, role, team, project-membership or permission fields. A valid entitlement proves only that David has issued a current commercial or approved-pilot grant for an organisation. Goliath must still resolve named identity, organisation membership, project membership, responsibility, resource scope and workflow authority independently.

## Security profile

- canonical JSON payload;
- Ed25519 (`EdDSA`) signatures with explicit key IDs for rotation;
- issuer, audience and organisation binding;
- issued-at, not-before and expiry enforcement;
- grant ID and nonce replay checks;
- explicit active, grace, restricted and revoked lifecycle decisions;
- fail-closed rejection of unsupported fields.

Verification is side-effect free. The receiving service must persist the accepted receipt and nonce atomically before treating a grant as consumed. Signing keys belong only in a server-side secret store; they must never be embedded in either browser application.

Run `npm test` in this directory to execute the contract boundary suite.
