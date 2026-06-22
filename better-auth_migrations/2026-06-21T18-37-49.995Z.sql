create table "organizationRole" ("id" text not null primary key, "organizationId" text not null references "organization" ("id") on delete cascade, "role" text not null, "permission" text not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz);

create index "organizationRole_organizationId_idx" on "organizationRole" ("organizationId");

create index "organizationRole_role_idx" on "organizationRole" ("role");