#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
npm --prefix shared ci --ignore-scripts >/dev/null
npm --prefix backend ci --include=optional --ignore-scripts >/dev/null
npm --prefix shared run validate
npm --prefix backend run validate
echo "Verification passed: card-credit-be (Node 22 / Fastify)"
