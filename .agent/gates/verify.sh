#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
./mvnw -B verify
echo "Verification passed: card-credit-be (Java 21 / Spring Boot)"
