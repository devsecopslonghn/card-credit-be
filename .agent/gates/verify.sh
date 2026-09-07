#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
npm --prefix shared run validate
npm --prefix backend run validate
echo "Verification passed: card-credit-be"
