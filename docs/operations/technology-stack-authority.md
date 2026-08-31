# Technology-stack authority and reproducibility

**Owner:** Platform, with the named stack owners in
`security/technology-stack.json`

**Executable gate:** `pnpm check:technology-stack`

**Review cadence:** the authority carries `reviewedAt` and `nextReviewBy`; an
expired review or exception fails the gate.

## Outcome

`security/technology-stack.json` is the single reviewable authority for the
repository-owned runtime and core stack. It records:

- Node runtime, Node type surface, pnpm, and the runtime-only package manifest;
- Better Auth, TanStack, React, Drizzle/Kit, Zod, BullMQ/ioredis, pg, pino,
  TypeScript, shadcn, and every repository CLI used by an authoritative command;
- every external base referenced by the Dockerfile inventory in
  `security/container-images.json`;
- every third-party GitHub Action repository, immutable commit, and human
  version label;
- the pino, Redis/BullMQ, and PostgreSQL runtime contracts; and
- every accepted exception with scope, owner, reason, and expiry.

All listed npm packages are exact declarations and exact direct-importer lock
resolutions. A frozen install remains the final package-graph integrity check;
the stack gate makes the intended versions reviewable without reverse-engineering
the lockfile.

## Authority order

When sources disagree, resolve them in this order:

1. Accepted RepKey ADRs and the beta capability authority decide product and
   architecture behavior.
2. `security/technology-stack.json` decides the repository-approved versions
   and runtime posture.
3. The exact installed package types/source and documentation for that exact
   version decide supported APIs. Do not implement against documentation for a
   different release.
4. `package.json`, `pnpm-lock.yaml`, `.nvmrc`, `package.runtime.json`, Dockerfiles,
   and workflows are executable projections checked against the authority.
5. Narrative documents explain the contract but cannot override an executable
   denial or migration rule.

Dependency changes are deliberately narrow. Upgrade one stack owner at a time,
read its version-matched release notes and installed types/source, update the
authority and lockfile together, run that owner's focused build/tests, and retain
the old immutable pin as the rollback point until release evidence is complete.
Do not combine a dependency upgrade with an unrelated domain migration.

## Enforced contracts

### Runtime and tooling

- Node `22.23.2` is identical in `.nvmrc`, both package manifests, CI setup, and
  the runtime probes in every Node-based Dockerfile.
- `@types/node` is exact and must remain on the same supported major as Node.
- pnpm `10.6.5` comes only from `package.json#packageManager`; the SHA-pinned
  setup action intentionally has no second version input.
- Release images use SHA-pinned Docker setup actions with Docker 29.7.2,
  Buildx 0.32.1, and BuildKit 0.30.0 from a digest-pinned driver image. The
  fixed `ubuntu-24.04` label's observed GitHub `ImageVersion` is signed into
  promotion manifest v4 and must be identical across all eight build roles.
- Better Auth schema commands, shadcn MCP configuration, Drizzle Kit, Railway,
  and all other listed CLIs execute repository-installed binaries.
- Mutable network execution through `npx -y`, `pnpm dlx`, or an `@latest`
  selector is rejected on authoritative command surfaces.

### Database schema and PostgreSQL

The migration SQL journal, Better Auth migration track, and registered sidecars
remain the schema authority. Never use `pnpm db:push` for this repository: the
command is absent from package scripts and affirmative shared/production guidance
is rejected mechanically.

The pg pool may retry transient **connection acquisition**. It must never replay
a SQL statement by default because a lost response can hide a committed write.
Operation-level replay requires its own idempotency key or authoritative
read-back. The stack gate and `src/shared/db/pool.test.ts` protect both sides of
that rule.

### BullMQ and Redis

- Production cache Redis and queue Redis are separate endpoints.
- Queue Redis must be Redis `6.2+`, expose `GETDEL`, and use `noeviction`; web and
  worker boot inspect the real endpoint before constructing queue work.
- Request/relay producers use a bounded 5-second command/connect budget and one
  ioredis retry. Blocking Worker and terminal-barrier connections use
  `maxRetriesPerRequest: null` as required by BullMQ.
- Queue, Worker, cache, inspection, and health clients own explicit error
  handling. Recurring work uses stable BullMQ Job Scheduler IDs and boot-time
  reconciliation.

### Pino and protected data

`pino-pretty` stays an exact, development-only dependency. The logger resolves
it with `createRequire(import.meta.url)` and falls back to structured output when
it is absent. `scripts/ci/pino-esm-build.test.ts` bundles and executes that path
as ESM rather than assuming native-source tests represent the built artifact.

Logs, metrics, traces, and Sentry consume
`src/shared/observability/sensitive-field-policy.ts`; new sensitive spellings
must be added there rather than to a surface-specific list.

### Containers and Actions

The technology-stack gate imports the existing container policy rather than
maintaining a second Dockerfile inventory. Every discovered external `FROM`
must be digest-pinned, registered in the stack authority, runtime-probed where
it is Node-based, dependency-monitored, built, smoke-tested, SBOMed, scanned,
and assigned an explicit promotion posture.

Every external GitHub Action must use the authority's full commit SHA and
matching `# v…` review label. Workflow service/container images remain covered
by the separate action/image pin gate.

## Accepted exception

`pnpm-action-version-input-omitted` is the only current exception. Its action
code is immutable by commit SHA; omitting the action's pnpm version input avoids
a second mutable version truth. The package-manager version remains exact in
`package.json`. The exception expires on 2027-02-26 and must be removed,
renewed with evidence, or replaced before then.

## Evidence and honest boundaries

The local repository gate proves declared versions, immutable inputs, Docker
inventory reuse, command/guidance denials, and source-level runtime invariants.
Its negative fixtures deliberately inject a ranged package, mutable CLI,
action tag, unknown Docker base, schema-push command, missing queue error
handler, and missing PostgreSQL acquisition wrapper so a self-confirming check
cannot pass.

This package does **not** by itself prove every feature-owner use of TanStack
Query/Form, React, Better Auth, Drizzle, or the settled application error
contract. Those changes remain with their owning product/safety packages. It
also does not manufacture a successful hosted CI run, an all-image clean
vulnerability result, or Railway runtime evidence; those must be retained at
the immutable release-candidate SHA.
