# Java migration status

The repository now has a Java 21 / Spring Boot 4.1.1 Maven application with
MongoDB wiring, `/health`, `/ready`, a JRE-only multi-stage image, Maven
Wrapper, and a Java CI gate.

This is intentionally a partial migration. The former Fastify implementation
under `backend/` still owns the externally observable REST, authentication,
workspace, financial, statement-payment, repair, and MCP behavior. It must be
ported capability-by-capability with executable compatibility tests before
the legacy tree can be removed or the Java image can be promoted.

The statement-payment regression requiring a voided historical
`STATEMENT_PAYMENT` not to block a valid replacement is not yet covered by the
Java implementation.
