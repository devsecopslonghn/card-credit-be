# Backend invariants

- Financial reads/writes remain workspace-scoped and preserve parent links.
- Mutating financial and MCP operations retain preview/confirm, idempotency,
  audit and transaction guards.
- Shared DTOs and stable error envelopes are validated by the local contracts package.
- The active runtime is Java 21/Spring Boot. It must not be promoted as a
  replacement for the compatible Node API until the REST and financial
  compatibility matrix passes.
- Deployment migration/index jobs must use the backend image tag currently in the chart.
- The Java runtime may not replace the compatible API image in any GitOps
  environment until the compatibility matrix and financial regression suite
  pass.
