# Backend system context

- Ownership: `backend/` Fastify/Mongoose REST/domain/MCP runtime and `shared/` contracts.
- Delivery: push to `master` runs Node quality, publishes `ghcr.io/devsecopslonghn/card-credit-be:<sha>`, then updates the chart repository.
- Runtime dependency: Node 22 and the existing MongoDB database; no FE source package is imported.
- Verification authority: `./.agent/gates/verify.sh` and the repository workflow.
