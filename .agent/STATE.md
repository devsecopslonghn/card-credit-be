# Agent state

- Harness status: multi-repository BE gate operational.
- Ownership: backend/API/domain correctness, financial invariants, MCP, backend tests/typecheck/lint/build and BE image build.
- Last verified state: CI run `34117720437` passed quality, image publish and chart update before the `/shared` runtime fix.
- Known blockers: none in source; the deployed candidate before the pending fix crashed because `/shared` was omitted from the runner image.
- Cross-repo note: changes to `shared/` must be mirrored and verified in `card-credit-fe/shared` when FE consumers are affected.
- Next action: run `./.agent/gates/verify.sh`, then follow the cross-repo delivery workflow.
