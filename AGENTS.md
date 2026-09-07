# card-credit-be working agreement

This repository is migrating the backend to Java 21/Spring Boot. The target
runtime is `src/main/java` and Maven; the legacy `backend/` tree is retained
only as an explicitly unshipped porting reference until capability parity is
verified. Do not delete it or publish the Java image as compatible with the
full API until the contract matrix is complete.

Run the lightweight gate before handoff:

```bash
./.agent/gates/verify.sh
```

The current gate covers Java compilation, tests, and packaging. Full REST,
Mongo, financial, authentication, and MCP compatibility remain migration
gates.
