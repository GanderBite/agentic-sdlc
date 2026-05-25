---
name: sprint003-docker-compose-required-var
description: docker-compose.yml uses :? required-variable syntax for POSTGRES_PASSWORD causing config validation to fail without .env file
metadata:
  type: project
---

The `docker compose -f docker-compose.yml config -q` gate fails with exit 15 because POSTGRES_PASSWORD uses the `${POSTGRES_PASSWORD:?...}` shell syntax which requires the variable to be set. In a CI/review context where no .env file is loaded, this fails.

**Why:** This has persisted since wave-2 of sprint-003 and through gate-replay-iter-1. The fixer has not addressed it, likely because changing required-var syntax to a default value is seen as a security concern (you don't want a real default for passwords).

**How to apply:** The correct fix is either: (a) change to `${POSTGRES_PASSWORD:-change-me}` for PoC-grade validation, or (b) add `env_file: [.env.example]` to docker-compose.yml so config validation can find values. Option (b) is cleaner. The .env.example already contains `POSTGRES_PASSWORD=change-me`.
