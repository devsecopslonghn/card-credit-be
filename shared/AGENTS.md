# shared contracts package

`shared` is the canonical runtime schema and DTO package consumed by backend
and frontend. Keep changes small, backwards-compatible unless required, and
run `npm run typecheck && npm test`. Do not put database, transport, secrets or
production data here. Preview/confirm payloads and error shapes must be
validated here when they are public contracts.
