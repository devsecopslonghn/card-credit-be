# Java migration status

The repository now has a Java 21 / Spring Boot 4.1.1 Maven application with
MongoDB wiring, `/health`, `/ready`, a JRE-only multi-stage image, Maven
Wrapper, and a Java CI gate.

The former Fastify implementation has now been removed from this repository.
The Java application currently contains the bootstrap and health/readiness
capabilities; the remaining REST, authentication, workspace, financial,
statement-payment, repair, and MCP capabilities still require porting before
the image is suitable for production promotion.

The statement-payment regression requiring a voided historical
`STATEMENT_PAYMENT` not to block a valid replacement is not yet covered by the
Java implementation.
