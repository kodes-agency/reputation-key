# Database Migrations

This project uses two separate migration systems that must be run in the correct order.

## Migration Authority

Use the production-equivalent migration authority for first-time setup and CI:

```bash
DEPLOY_MIGRATE=1 pnpm db:migrate-deploy
```

Railway deployments invoke the same `pnpm db:migrate-deploy` runner under
platform identity rather than setting `DEPLOY_MIGRATE`.

This provisions the pinned Better Auth tables, applies the staged Drizzle
journal, runs registered sidecars, and performs provider-subject initialization.
On an empty database, also set one sealed
`REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS` entry before running the command.

## Development Workflow

Use the same journaled workflow in development, CI, shared beta environments, and
production. Never use `pnpm db:push` against this repository's schema: it bypasses
the authoritative migration journal and can conceal deploy-time drift.

## Adding Auth Schema Changes

1. Modify the auth config in `src/shared/auth/auth.ts`
2. Apply migration: `pnpm auth:migrate`

## Adding Business Schema Changes

1. Modify the Drizzle schema in `src/shared/db/schema/`
2. Generate migration: `pnpm db:generate`
3. Review the generated SQL in `drizzle/`
4. Apply migration: `pnpm db:migrate`

## CI/CD

CI runs `pnpm db:migrate-deploy` (see `.github/workflows/ci.yml` Predeploy migration parity).
