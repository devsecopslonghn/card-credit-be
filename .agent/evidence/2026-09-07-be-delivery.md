# Evidence: backend split delivery and runtime image correctness

- task ID: 2026-09-07-multi-repo-delivery
- relevant commits/run: `card-credit-be@b4f2076` and `5a0fc3c`, GitHub Actions `34118960146`
- ownership claim: BE owns API/domain/MCP/financial correctness, tests/typecheck/lint/build and the BE image.
- root cause: the runner image omitted `/shared` although `@card-credit/contracts` is installed as `file:../shared` and resolves through that runtime path; the deployed pod failed with `ERR_MODULE_NOT_FOUND`.
- checks: `./.agent/gates/verify.sh`; CI quality, image publish and chart update jobs; `skopeo inspect docker://ghcr.io/devsecopslonghn/card-credit-be:5a0fc3c25810bfbde9ade5bdb4daaec44d226faa`.
- regression coverage: `backend/tests/dockerfile.test.ts` requires runner copies of both pruned node_modules and `/shared`.
- result: backend gate passed (177 tests/build); CI passed; registry layer sum 77,903,117 bytes and Kubernetes pull metadata 77,915,569 bytes; current pod is 1/1 Running.
- limitations: registry metadata did not provide an independent uncompressed total; no production deployment was performed.
- final result: PASS
