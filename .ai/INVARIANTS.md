# Backend invariants

- Financial reads/writes remain workspace-scoped and preserve parent links.
- Mutating financial and MCP operations retain preview/confirm, idempotency,
  audit and transaction guards.
- Shared DTOs and stable error envelopes are validated by the local contracts package.
- The active runtime is Node 22/Fastify and must preserve the existing REST and
  MCP financial contracts.
- Deployment migration/index jobs must use the backend image tag currently in the chart.
- The chart must not reference an image that was not built from the compatible
  backend Dockerfile and its full financial regression suite.
