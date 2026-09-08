# card-credit-be working agreement

This repository owns the compatible Fastify/Mongoose backend under `backend/`,
its shared contracts under `shared/`, financial/MCP APIs, tests and image.
The Java bootstrap was removed from the delivery path because it did not yet
implement the existing API contract.

Run the lightweight gate before handoff:

```bash
./.agent/gates/verify.sh
```

The current gate covers Java compilation, tests, and packaging. Full REST,
Mongo, financial, authentication, and MCP compatibility remain migration
gates.
