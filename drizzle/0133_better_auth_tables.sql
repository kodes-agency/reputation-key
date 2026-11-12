-- Better Auth's tables as the pinned runtime creates them, column for column.
-- A database the runtime already provisioned keeps its tables untouched; one
-- with only some of them stops here rather than guessing. The first journal
-- files reference these tables, so a new database runs this file before them
-- (the journal entry is a prerequisite). "organizationRole" exists only for
-- 0001's index and trigger until 0130 drops it.
DO $auth$
BEGIN
  IF to_regclass('public."user"') IS NULL THEN
    CREATE TABLE "user" ("id" text NOT NULL PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL, "image" text, "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL);
    CREATE TABLE "session" ("id" text NOT NULL PRIMARY KEY, "expiresAt" timestamptz NOT NULL, "token" text NOT NULL UNIQUE, "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "updatedAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE, "activeOrganizationId" text);
    CREATE TABLE "account" ("id" text NOT NULL PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "updatedAt" timestamptz NOT NULL);
    CREATE TABLE "verification" ("id" text NOT NULL PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL);
    CREATE TABLE "organization" ("id" text NOT NULL PRIMARY KEY, "name" text NOT NULL, "slug" text NOT NULL UNIQUE, "logo" text, "createdAt" timestamptz NOT NULL, "metadata" text, "contactEmail" text);
    CREATE TABLE "organizationRole" ("id" text NOT NULL PRIMARY KEY, "organizationId" text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE, "role" text NOT NULL, "permission" text NOT NULL, "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "updatedAt" timestamptz);
    CREATE TABLE "member" ("id" text NOT NULL PRIMARY KEY, "organizationId" text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE, "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE, "role" text NOT NULL, "createdAt" timestamptz NOT NULL);
    CREATE TABLE "invitation" ("id" text NOT NULL PRIMARY KEY, "organizationId" text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE, "email" text NOT NULL, "role" text, "status" text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "inviterId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE, "staffParticipationId" text, "propertyIds" text);
    CREATE INDEX "session_userId_idx" ON "session" ("userId");
    CREATE INDEX "account_userId_idx" ON "account" ("userId");
    CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
    CREATE INDEX "organizationRole_organizationId_idx" ON "organizationRole" ("organizationId");
    CREATE INDEX "organizationRole_role_idx" ON "organizationRole" ("role");
    CREATE INDEX "member_organizationId_idx" ON "member" ("organizationId");
    CREATE INDEX "member_userId_idx" ON "member" ("userId");
    CREATE INDEX "invitation_organizationId_idx" ON "invitation" ("organizationId");
    CREATE INDEX "invitation_email_idx" ON "invitation" ("email");
  ELSIF to_regclass('public."session"') IS NULL
    OR to_regclass('public."account"') IS NULL
    OR to_regclass('public."verification"') IS NULL
    OR to_regclass('public."organization"') IS NULL
    OR to_regclass('public."member"') IS NULL
    OR to_regclass('public."invitation"') IS NULL THEN
    RAISE EXCEPTION 'Better Auth tables are incomplete: restore the missing ones before migrating';
  END IF;
END
$auth$;
