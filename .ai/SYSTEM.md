# Backend system context

- Ownership: `src/main/java` Spring Boot REST/domain/persistence runtime.
- Legacy reference: `backend/` is not part of the Java image and remains only until parity migration is verified.
- Delivery: push to `master` runs quality, publishes `ghcr.io/devsecopslonghn/card-credit-be:<sha>`, then updates the chart repository.
- Runtime dependency: Java 21 JRE and the existing MongoDB database; no FE source package is imported.
- Verification authority: `./.agent/gates/verify.sh` and the repository workflow.
