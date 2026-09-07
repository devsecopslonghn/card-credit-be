# card-credit-be working agreement

This repository owns the Java 21/Spring Boot runtime under `src/`, its Mongo
persistence boundary, API capabilities, tests, and container image. The
former Fastify/Node implementation has been removed.

Run the lightweight gate before handoff:

```bash
./.agent/gates/verify.sh
```

The current gate covers Java compilation, tests, and packaging. Full REST,
Mongo, financial, authentication, and MCP compatibility remain migration
gates.
