# Backend invariants

- Financial reads/writes remain workspace-scoped and preserve parent links.
- Mutating financial and MCP operations retain preview/confirm, idempotency,
  audit and transaction guards.
- Shared DTOs and stable error envelopes are validated by the local contracts package.
- The runtime image must start `dist/src/server.js` with all linked shared
  runtime dependencies available; build-only dependencies must be pruned.
- Deployment migration/index jobs must use the backend image tag currently in the chart.
