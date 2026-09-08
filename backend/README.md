# Backend

Standalone Fastify runtime that owns all application APIs, authentication,
authorization, MongoDB models and domain behavior. It exposes process liveness
at `/health` and database readiness at `/ready`.

```bash
npm ci
MONGODB_URI="mongodb://127.0.0.1/card-credit-development" \
AUTH_SECRET="use-at-least-32-random-characters" \
npm run dev
```

The server listens on port `3001` by default. Readiness becomes healthy after
MongoDB connects. Do not point development or tests at production data.
`backend/Dockerfile` builds and runs the production runtime as a non-root user.

Browser traffic remains same-origin through the Next.js frontend rewrite. CORS
is disabled; state-changing cross-origin browser requests are rejected. The
backend owns the secure signed session cookie and workspace/role enforcement.

An empty catalog is valid operationally: provider/product lists are empty and
detail lookups return `PRESET_NOT_FOUND`. Readiness only confirms the database
connection. Before first production use, an operator must explicitly import the
validated baseline; startup never imports or mutates catalog data.

## Explicit catalog import

Dry-run is the default and reports create/update/unchanged/conflict counts:

```bash
MONGODB_URI="mongodb://127.0.0.1/card-credit-development" npm run import:catalog
```

After reviewing the dry-run and taking a database backup, apply explicitly:

```bash
MONGODB_URI="mongodb://127.0.0.1/card-credit-development" npm run import:catalog -- --apply
```

Production refuses the command unless the operator additionally sets
`ALLOW_PRODUCTION_CATALOG_IMPORT=true`. This override is import-only and should
not be a normal runtime environment variable. Rollback uses the database backup
or a reviewed baseline/recovery import; reverting application code does not
rewrite catalog documents.
