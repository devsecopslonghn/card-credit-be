# Backend system context

- Ownership: `backend/` Fastify, REST, MCP, domain/services, persistence and jobs.
- Contract input: local `shared/`; synchronize contract changes with `card-credit-fe/shared`.
- Delivery: push to `master` runs quality, publishes `ghcr.io/devsecopslonghn/card-credit-be:<sha>`, then updates the chart repository.
- Runtime dependency: the `file:../shared` package resolves through `/shared` in the container; the runner must retain that path and its production dependencies.
- Verification authority: `./.agent/gates/verify.sh` and the repository workflow.
