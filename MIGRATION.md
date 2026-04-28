# Database Migrations

This project uses two separate migration systems that must be run in the correct order.

## Migration Order

**Auth tables must exist before business tables.** Run migrations in this order:

1. **Auth migrations** (Better Auth tables):

   ```bash
   pnpm auth:migrate
   ```

   This creates the `user`, `session`, `account`, `verification`, `organization`, `member`, and `invitation` tables.

2. **Business migrations** (Drizzle tables):
   ```bash
   pnpm db:migrate
   ```
   This creates `properties`, `teams`, `staff_assignments`, and `audit` tables. Some business tables have foreign keys referencing auth tables.

## First-Time Setup

```bash
# 1. Generate auth migration (if not already generated)
pnpm auth:generate

# 2. Apply auth migrations
pnpm auth:migrate

# 3. Generate business migration
pnpm db:generate

# 4. Apply business migrations
pnpm db:migrate
```

## Development Workflow

For rapid prototyping in development, you can use schema push instead of migrations:

```bash
pnpm db:push
```

> ⚠️ `db:push` does not create migration files. Use `db:generate` + `db:migrate` for production.

## Adding Auth Schema Changes

1. Modify the auth config in `src/shared/auth/auth.ts`
2. Generate migration: `pnpm auth:generate`
3. Apply migration: `pnpm auth:migrate`

## Adding Business Schema Changes

1. Modify the Drizzle schema in `src/shared/db/schema/`
2. Generate migration: `pnpm db:generate`
3. Review the generated SQL in `drizzle/`
4. Apply migration: `pnpm db:migrate`

## CI/CD

In CI/CD pipelines, always run `pnpm auth:migrate` before `pnpm db:migrate` to respect the dependency order.
