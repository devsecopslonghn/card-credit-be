# Agent state

- Harness status: multi-repository BE gate operational.
- Ownership: backend/API/domain correctness, financial invariants, MCP, backend tests/typecheck/lint/build and BE image build.
- Last verified state: Java CI run `34125373214` passed `./mvnw verify` and published a bootstrap image; Argo deliberately still runs the last compatible Node image `d2cee5e...`.
- Known blocker: the active Java backend has no REST/auth/financial/statement-payment/MCP implementation. The screenshot's payment failure is therefore not safely fixable in this repository without porting the missing compatibility surface.
- Evidence: `MIGRATION_STATUS.md`, commit `f218da9`, and `.agent/evidence/2026-09-08-statement-payment-blocker.md`.
- Cross-repo note: FE currently targets `/api/cards/:id/statements/:statementId/payment/preview`; do not promote the Java image until that contract and its financial regression suite exist.
- Next action: human decision is required to scope the Java statement-payment/API port or restore the compatible Node runtime as the migration baseline.
