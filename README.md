# card-credit-be

Java 21 / Spring Boot backend for Card Credit. The repository has one Maven
runtime under `src/`; the former Fastify/Node implementation and copied
contract package have been removed.

## Local verification

```bash
./mvnw -B verify
```

The backend image is published as
`ghcr.io/devsecopslonghn/card-credit-be:<commit-sha>`.
