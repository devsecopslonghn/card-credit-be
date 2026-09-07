# card-credit-be working agreement

This repository owns the Fastify backend, REST/MCP adapters, domain services,
Mongo models, financial invariants and the backend container image. The local
`shared/` directory is the backend copy of the canonical contracts and must
stay compatible with the FE copy when contract changes span repositories.

Run the lightweight gate before handoff:

```bash
./.agent/gates/verify.sh
```

The gate covers shared validation and backend typecheck, lint, critical tests
and build. Financial mutations preserve workspace scoping, preview/confirm,
command idempotency, transactions and audit behavior. MCP transport remains a
thin adapter over the same services.
