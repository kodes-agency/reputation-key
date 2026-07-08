-- Idempotent: safe to apply after the bootstrap (0000-auth-tables-bootstrap.sql)
-- already created the organizationRole table + indexes.
create table if not exists "organizationRole" ("id" text not null primary key, "organizationId" text not null references "organization" ("id") on delete cascade, "role" text not null, "permission" text not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz);

create index if not exists "organizationRole_organizationId_idx" on "organizationRole" ("organizationId");

create index if not exists "organizationRole_role_idx" on "organizationRole" ("role");
