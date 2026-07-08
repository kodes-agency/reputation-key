-- 0000-auth-tables-bootstrap.sql
-- Better Auth baseline schema — provisions the 8 auth tables on a fresh database.
--
-- WHY THIS EXISTS: @better-auth/cli never captured a baseline migration, so
-- `pnpm auth:migrate` silently does nothing on an empty DB (only 2 incremental
-- files exist, both assuming these tables). This file is the reproducible
-- bootstrap. See docs/ba-fresh-db-provisioning.md.
--
-- APPLY ORDER (fresh DB):
--   1. psql -f scripts/migrations/0000-auth-tables-bootstrap.sql   (this file)
--   2. pnpm auth:migrate        (2 incremental BA files — idempotent no-ops post-bootstrap)
--   3. pnpm db:migrate          (Drizzle business tables)
--   4. psql -f scripts/migrations/2026-07-06-permission-version-triggers.sql  (DAC tables/triggers/index)
--
-- Idempotent (IF NOT EXISTS) so re-running on a DB that already has the tables
-- is a safe no-op. DAC triggers/functions/index are NOT here — they are created
-- in step 4. Captured from the live Neon schema 2026-07-06.

-- ── user ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean DEFAULT false NOT NULL,
    image text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_pkey PRIMARY KEY (id),
    CONSTRAINT user_email_unique UNIQUE (email)
);

-- ── organization ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "organization" (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo text,
    "createdAt" timestamptz NOT NULL,
    metadata text,
    "contactEmail" text,
    "billingCompanyName" text,
    "billingAddress" text,
    "billingCity" text,
    "billingPostalCode" text,
    "billingCountry" text,
    "responseSlaHours" integer,
    CONSTRAINT organization_pkey PRIMARY KEY (id),
    CONSTRAINT organization_slug_key UNIQUE (slug)
);

-- ── session (FK → user) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "session" (
    id text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL,
    "activeOrganizationId" text,
    CONSTRAINT session_pkey PRIMARY KEY (id),
    CONSTRAINT session_token_unique UNIQUE (token),
    CONSTRAINT session_userId_user_id_fk FOREIGN KEY ("userId")
        REFERENCES "user"(id) ON DELETE CASCADE
);

-- ── account (FK → user) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "account" (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp without time zone,
    "refreshTokenExpiresAt" timestamp without time zone,
    scope text,
    password text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_pkey PRIMARY KEY (id),
    CONSTRAINT account_userId_user_id_fk FOREIGN KEY ("userId")
        REFERENCES "user"(id) ON DELETE CASCADE
);

-- ── verification ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "verification" (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now(),
    "updatedAt" timestamp without time zone DEFAULT now(),
    CONSTRAINT verification_pkey PRIMARY KEY (id)
);

-- ── member (FK → organization, user) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "member" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL,
    role text NOT NULL,
    "createdAt" timestamptz NOT NULL,
    CONSTRAINT member_pkey PRIMARY KEY (id),
    CONSTRAINT member_organizationId_fkey FOREIGN KEY ("organizationId")
        REFERENCES "organization"(id) ON DELETE CASCADE,
    CONSTRAINT member_userId_fkey FOREIGN KEY ("userId")
        REFERENCES "user"(id) ON DELETE CASCADE
);

-- ── invitation (FK → organization, user[inviterId]) ────────────────────
CREATE TABLE IF NOT EXISTS "invitation" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    email text NOT NULL,
    role text,
    status text NOT NULL,
    "expiresAt" timestamptz NOT NULL,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "inviterId" text NOT NULL,
    "propertyIds" text,
    CONSTRAINT invitation_pkey PRIMARY KEY (id),
    CONSTRAINT invitation_organizationId_fkey FOREIGN KEY ("organizationId")
        REFERENCES "organization"(id) ON DELETE CASCADE,
    CONSTRAINT invitation_inviterId_fkey FOREIGN KEY ("inviterId")
        REFERENCES "user"(id) ON DELETE CASCADE
);

-- ── organizationRole (FK → organization) ───────────────────────────────
-- NOTE: the case-insensitive uniqueness index (organization_role_org_role_lower_unique)
-- is a DAC object — created in step 4 (permission-version-triggers.sql), not here.
CREATE TABLE IF NOT EXISTS "organizationRole" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    role text NOT NULL,
    permission text NOT NULL,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamptz,
    CONSTRAINT "organizationRole_pkey" PRIMARY KEY (id),
    CONSTRAINT "organizationRole_organizationId_fkey" FOREIGN KEY ("organizationId")
        REFERENCES "organization"(id) ON DELETE CASCADE
);

-- ── Indexes ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS invitation_email_idx ON "invitation" (email);
CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON "invitation" ("organizationId");
CREATE INDEX IF NOT EXISTS "member_organizationId_idx" ON "member" ("organizationId");
CREATE INDEX IF NOT EXISTS "member_userId_idx" ON "member" ("userId");
CREATE INDEX IF NOT EXISTS "organizationRole_organizationId_idx" ON "organizationRole" ("organizationId");
CREATE INDEX IF NOT EXISTS "organizationRole_role_idx" ON "organizationRole" (role);
CREATE UNIQUE INDEX IF NOT EXISTS organization_slug_uidx ON "organization" (slug);
