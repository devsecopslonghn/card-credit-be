# card-credit-be

Fastify/Mongoose backend and MCP server for Card Credit. The repository is
self-contained and keeps the shared runtime contracts under `shared/`.

## Local verification

```bash
npm --prefix shared ci
npm --prefix backend ci --include=optional
npm --prefix shared run validate
npm --prefix backend run validate
```

The backend image is published as
`ghcr.io/devsecopslonghn/card-credit-be:<commit-sha>`.
