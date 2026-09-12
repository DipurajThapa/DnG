# Target Topology

## Repository

```text
DnG/
  apps/
    david/                 # public/customer lifecycle app
    goliath/               # project-control web app
  packages/
    identity-contracts/    # identity, membership, tenant/admission contracts
    authorization/         # role/scope/permission evaluation
    audit/                 # correlation/audit contracts
    shared-ui/             # visual primitives only; no business authority
    goliath-core/          # validated Goliath domain/application baseline
  db/
    david/                 # David migrations/schema
    identity/              # shared identity/admission schema
    goliath/               # Goliath migrations/schema
  docs/
    architecture/
    workflows/
    acceptance/
  tests/
    contract/
    e2e/
```

## Runtime

```text
Visitor / Customer                     Project user
        |                                  |
        v                                  v
   David (Vercel)                    Goliath (Vercel)
        |                                  |
        +----------- Shared Auth ----------+
                           |
                           v
                    Identity contracts
                           |
             +-------------+-------------+
             |                           |
             v                           v
      David customer DB            Goliath project DB
             |                           |
             |                     governed services
             |                           |
             +--- entitlement/admission ->+
```

## David to Goliath handoff

David may create or amend **commercial entitlement and admission evidence**. It must not directly create arbitrary Goliath project-role authority from a browser redirect.

A successful handoff requires:

1. verified identity;
2. active organisation/customer state;
3. current entitlement or approved pilot/free grant;
4. admitted organisation membership;
5. explicit project/responsibility assignment where applicable;
6. Goliath server-side authorization at every protected read/write.

## Deployment model

Two Vercel projects from one repository:

- `david` -> root `apps/david`
- `goliath-project-management-tracker` -> root `apps/goliath`

One Git history, two release boundaries.

## Persistence

PostgreSQL is the target transactional store. Browser clients never receive a PostgreSQL password. Sensitive operations go through authenticated server-side/API/database functions that re-evaluate authority at commit time.

## Governance relationships

Organisation membership, team membership and project assignment are separate relationships. Organisation Admin may admit people, create teams and appoint Project Admins. Project Admin may assign admitted people and existing teams only within the governed project. Neither role receives delivery visibility merely because it administers access.

A team can be assigned to many projects, and a project can use many teams. A person can receive direct project access in addition to team-derived access. Every effective responsibility retains its source so reassignment can remove only the intended relationship.

## Integrations

External facts follow:

`authoritative source -> authenticated intake/reconciliation -> mapping/authority check -> canonical projection -> impact/decision -> authorised effect -> provider receipt/readback -> audit`

No provider action reports success until provider evidence confirms the relevant external state.
