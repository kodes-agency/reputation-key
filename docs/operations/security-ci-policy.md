# BQC-7.7 — Supply-chain and Security CI Policy

**Date:** 2026-07-31
**Owner:** Bozhidar Denev (team label in machine-readable exception files: `platform`)
**Scope:** every supply-chain/security gate that runs in CI, its severity
threshold, and its exception/expiry rules. BQC-8 reruns these same gates
against the release candidate; this document is the single scan policy.

## The one hard rule

Master plan §5 rule 9 (`master-plan.md`): **no required soft gates** — a
required scan never uses `continue-on-error`, never fails log-only, and never
hides behind an unowned exception. Every gate below fails the job (non-zero
exit / failed action) and therefore blocks the PR. There is no
`continue-on-error` anywhere in `.github/workflows/`.

## Gate inventory

| Gate                                     | Where (step / job)                                                 | Script / action                                                          | Threshold (fails on)                                                                                            | Artifact / output                                |
| ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Dependency vulnerability audit           | `check` job, step "Dependency vulnerability audit"                 | `pnpm check:dependency-audit` → `scripts/check-dependency-audit.mjs`     | prod tree: **high+critical**; full tree: **critical** (highs in dev tooling are printed every run, do not fail) | Step log (advisory ids, paths, patched versions) |
| Secret scanning (history + diffs)        | `secrets` job, step "Gitleaks"                                     | `docker run zricethezav/gitleaks@<digest> git /repo` (fetch-depth: 0)    | **any** finding — PRs scan the PR range (`base..HEAD`); pushes/dispatch scan all refs (full history)            | Step log (redacted findings)                     |
| Static security analysis — eslint        | `check` job, step "Lint"                                           | `eslint-plugin-security` recommended as **errors** in `eslint.config.js` | any recommended-rule finding on production code                                                                 | Step log                                         |
| Static security analysis — CodeQL        | `codeql.yml` workflow (push/PR to main + weekly)                   | `github/codeql-action` init+analyze, `security-extended` queries         | analysis **failure** fails; findings become code-scanning alerts                                                | SARIF → Security tab (code scanning)             |
| License policy                           | `check` job, step "License policy"                                 | `pnpm check:licenses` → `scripts/check-licenses.mjs`                     | any prod/dev dependency license not allow-listed or excepted                                                    | Step log (full inventory per tree)               |
| Lockfile integrity                       | every job that installs                                            | `pnpm install --frozen-lockfile` (ci.yml, simulation.yml, Dockerfiles)   | install fails on lockfile/manifest drift                                                                        | —                                                |
| Pinned actions/images                    | `check` job, step "Action/image pin policy"                        | `pnpm check:action-pins` → `scripts/check-action-pins.mjs`               | any `uses:` not full-SHA + `# v…` comment; any `image:` not digest-pinned                                       | Step log                                         |
| SBOM — source                            | `check` job, steps "Generate SBOM" + "Upload SBOM"                 | `anchore/sbom-action` (SPDX-JSON, source scope) — BQC-7.1                | generation failure                                                                                              | `sbom-spdx` artifact, 30d                        |
| SBOM — images                            | `docker` job, one named step per classified image                  | `anchore/sbom-action` with `image:` (SPDX-JSON)                          | generation failure                                                                                              | `sbom-images-spdx` artifact, 30d                 |
| Container/image + artifact-content scan  | `docker` job, steps "Vulnerability scan … (grype)"                 | `anchore/scan-action` (grype), `fail-build: true`                        | **high+critical** (`severity-cutoff: high`)                                                                     | SARIF → code scanning; step log table            |
| Production dependency/prune verification | `docker` job, step "Smoke images"                                  | inline shell: sentinel devDeps absent + prod tree present                | any sentinel devDependency in `/app/node_modules`                                                               | Step log                                         |
| Migration artifact consistency           | `check` job, steps "Predeploy migration parity" + "Schema drift …" | `pnpm db:migrate-deploy` (BQC-7.1) + `pnpm check:schema-drift`           | parity divergence / model↔catalog drift                                                                         | Step log                                         |

**Artifact-content scanning — interpretation:** each classified image is the
artifact that actually runs. The promoted web image contains `.output` plus
`dist-worker`; the worker and sidecar images contain their named bundles; the
CI-only sandbox and performance runner contain only their prebuilt support
bundles and required runtime dependencies. Scanning all ten images with grype
therefore is the artifact-content scan: OS packages, bundles, and the production
`node_modules` that ship. The source-tree SBOM plus the ten image SBOMs cover
both sides of the build without treating non-promoted tools as production.

## Severity and exception policy

### Thresholds

- **Dependency audit:** production dependencies fail at **high** (they ship in
  the images). The full tree (incl. dev tooling) fails at **critical**; dev
  highs are printed on every run for visibility and are expected to burn down
  via Dependabot (B0.4) — they are tooling-only and cannot reach production
  (proven by the prod-prune gate). Rationale for not gating dev at high: the
  current reality is 11 dev-only highs in abandonware-adjacent tooling chains
  (storybook/jest, eslint, shadcn CLI) with no production exposure; a hard
  dev-high gate would force immediate risky overrides for zero runtime gain.
  Revisit at the quarterly review.
- **Secrets:** any finding fails — secrets have no acceptable severity.
- **CodeQL:** analysis failure fails the workflow; query findings land as
  code-scanning alerts (Security tab) and are triaged there. (Branch/ruleset
  wiring to fail PRs on new alerts is platform configuration, not workflow
  YAML — see the platform notes.)
- **Licenses:** allow-list is absolute; anything outside it needs a reviewed,
  dated exception.
- **Grype:** high+critical fails every classified image scan.
- **eslint-plugin-security:** recommended ruleset as errors on production
  code; deliberate rule deviations documented below.

### Exception schema and expiry

Machine-readable exception files live in `security/`:

- `security/audit-exceptions.json` — dependency audit exceptions:
  `{ id (GHSA/CVE/url), scope ("prod"|"full"), owner, reason, expiresAt (ISO date) }`
- `security/license-policy.json` — `allowed` list + `exceptions`:
  `{ package (exact or trailing "*"), license, scope ("prod"|"dev"|"both"), owner, reason, expiresAt }`
- `.grype.yaml` — grype ignore rules; every entry carries
  `# owner / reason / expiresAt` comments directly above it (grype has no
  native expiry field).

Rules, enforced by the gates themselves:

1. **Expired exceptions FAIL the gate** (audit + license scripts compare
   `expiresAt` to the run date; grype expiries are reviewed at the cadence
   below — the gate cannot read comments).
2. **Stale audit exceptions FAIL** (an exception matching no firing advisory
   must be deleted with the fix). Stale license exceptions WARN only, because
   os/cpu-conditional packages legitimately appear per-platform.
3. **Zero exceptions is the target.** Fix the dependency/image first; an
   exception is a reviewed, dated debt record, not a silencer.
4. **Review cadence:** every exception is re-justified at least quarterly
   (dates are set ≤ ~3 months out), and the full exception set is re-audited
   during BQC-8 release-candidate promotion.

### Current exceptions (2026-07-31)

- Dependency audit: **none** (empty file). Prod tree: 0 high/critical
  (1 moderate + 2 low, esbuild dev-server issues via `better-auth →
drizzle-kit` — build tooling, reported). Full tree: 11 high, 0 critical —
  all dev tooling (storybook/jest `brace-expansion`, `@tanstack/devtools-vite`
  `shell-quote`, shadcn CLI `fast-uri`/`postcss`, `sharp`, eslint
  `brace-expansion`); printed every run, burning down via Dependabot.
- Licenses: 4 reviewed entries — `lightningcss*` (MPL-2.0, build-time CSS
  transformer), `caniuse-lite` (CC-BY-4.0, build-time data), `axe-core`
  (MPL-2.0, dev-only a11y engine), `@img/sharp-libvips-*` (LGPL-3.0-or-later,
  dev-only sharp binaries). Each carries owner/reason/expiry in
  `security/license-policy.json`.
- Grype: 24 wont-fix/not-fixed Debian CVE entries + 2 Go-stdlib package
  entries in `.grype.yaml` (each with owner/reason/expiry). The fixable
  classes were fixed instead of excepted: base image bumped to the newest
  node:22-slim build (2026-07-29) and the npm CLI stripped from every runtime
  that does not execute package management (cleared all 6 npm-bundled findings incl. Critical `tar`
  GHSA-23hp-3jrh-7fpw — 57 → 51 high/critical per image).
  The 2026-09-04 vulnerability DB (v6.1.9) added five HIGH base-image
  findings — four util-linux mount-helper escalations and one system-zlib
  `gz_vacate()` overflow — with no patched bookworm package and identical
  versions in the newest node:22-slim build. Their reachable surface was
  removed rather than excepted: every production runtime stage now drops all
  setuid/setgid bits, and the runtime `node` is built `shared_zlib: false`
  and links no libz. The five CVE ids carry owner/reason/expiry
  (expiresAt 2026-12-04).

## Per-gate notes

### Lockfile integrity

`pnpm install --frozen-lockfile` IS the lockfile-integrity gate: CI,
simulation, and every Node-based Dockerfile (full and production-only stages)
install frozen, so a hand-edited lockfile or an out-of-sync manifest fails
the build. `package.json#packageManager` (pnpm@10.6.5) + corepack pin the
installer itself.

### Pinned actions and images

Convention since BQC-7.1, now **enforced** by `check:action-pins`: every
`uses:` is `owner/repo@<40-hex-SHA> # vX.Y.Z`; every workflow `image:`
(service containers: postgres, redis) is digest-pinned with a tag comment;
the gitleaks invocation pins `zricethezav/gitleaks:vX@sha256:…`. The Docker
base images (`node:22-slim@sha256:…`) are digest-pinned in the Dockerfiles.
`uses:` under a step's `with:` (e.g. the locally-built `repkey-web:ci` handed
to the SBOM/scan actions) is not a registry reference and is out of scope —
the actions consuming them are themselves SHA-pinned.

### Dependabot (B0.4)

`.github/dependabot.yml` covers npm, GitHub Actions, and every distinct
Dockerfile directory weekly. All current custom-named Dockerfiles are in `/`;
`check:container-images` requires a new Docker ecosystem directory entry if
that inventory expands elsewhere. Dependabot is the burn-down engine for
dependency, action, and base-image updates; the gates above are the enforcement
floor (they do not depend on Dependabot firing).

**Exactly pinned, deliberately:** `better-auth` carries no range (`1.6.23`, not
`^1.6.23`). `src/routes/api/auth/$.ts` refuses a list of better-auth's OWN
route paths at the HTTP boundary (raw organization writes + self-service
`/sign-up/email`); a minor bump that renames a route would silently narrow that
refusal to nothing, and the colocated test asserts our handler, not the
upstream route table. The test therefore also pins the version and fails on any
move: on a Dependabot bump, re-verify the organization plugin route files
(`crud-access-control.mjs` / `crud-invites.mjs` / `crud-members.mjs`) and
`/sign-up/email`, then move `VERIFIED_BETTER_AUTH_VERSION`. All 12 paths were
confirmed present in 1.6.23 (the code comment previously claimed 1.6.12, while
1.6.23 was installed — the drift this pin closes).

### CodeQL / GHAS platform note

The repository is **public**, so code scanning is free and CodeQL is wired as
`.github/workflows/codeql.yml` (javascript-typescript, `security-extended`,
push/PR to main + weekly cron, SARIF upload via the pre-provisioned
`security-events: write` permission). If the repo ever goes private without
GitHub Advanced Security, the workflow would 403 — at that point either
enable GHAS (platform setting) or remove the workflow; do NOT downgrade it to
`continue-on-error`. Failing PRs on _new_ alerts (vs analysis failure) is a
branch-ruleset setting ("code scanning results" required check) — platform
configuration to be flipped during BQC-8 hardening, noted here so it is not
silently lost.

### GitHub merge and production-environment controls

**Re-verified 2026-08-21 against the live API: `main` has NO branch protection.**

```
GET /repos/kodes-agency/reputation-key/rulesets            -> []
GET /repos/kodes-agency/reputation-key/branches/main/protection
   -> 404 {"message":"Branch not protected"}
```

The ruleset described below (`20890731`, `main-required-pull-request-and-ci`)
**does not exist**. Either it was never created, or it was deleted after the
2026-08-15 readback. This section previously asserted it as verified fact, and
`.github/workflows/ci.yml` contradicted it in a comment ("main carries no
branch protection"). The workflow comment was the accurate one.

**Consequence, stated plainly: every "hard gate" in this repository is
advisory.** `check`, `docker`, `secrets`, `storybook`, `storybook-test`, `e2e`,
`audit` and `Analyze (javascript-typescript)` all run, and all report, but
nothing prevents a merge while they are red, and nothing prevents a direct push
to `main`. Any reasoning elsewhere in this repo that treats a passing check as
a _precondition_ for merge is reasoning about a control that is not enabled.

The intended posture — recorded here as intent, NOT as fact — was:

- pull request required, one approval, stale-review dismissal, Code Owner
  review where applicable, approval after the last push, resolved threads;
- squash-only merge; branch deletion and non-fast-forward updates denied;
- required checks `check`, `docker`, `secrets`, `storybook`, `storybook-test`,
  `e2e`, `audit`, `Analyze (javascript-typescript)`, with strict branch
  freshness;
- `simulate` is absent from that list and should be added — it is the only
  check that caught the 126-orphan fixture defect, it is a 5-minute job with a
  paths filter, and it currently gates nothing;
- GitHub environment `production` (ID `19948405265`) targeting protected
  branches with a reviewer and self-review prevention. Note this one depends on
  "protected branches" existing, so it cannot be doing anything today either.
  A previous readback reported `can_admins_bypass: true`, which would need
  disabling before it is a hard release control.

Enabling this is a repository-owner action and a workflow change, so it is left
as an explicit decision rather than assumed.

**Lesson for this section specifically:** a platform readback is evidence with
an expiry date, not a permanent fact. Recording one as "Verified <date>" and
then reading it later as a standing guarantee is how a repository ends up
believing it has controls it does not have. Release validation must query
GitHub again and compare the exact rule/check set; the same applies to the
environment, which does not by itself prove a Railway deployment uses it.

### eslint-plugin-security triage (deliberate deviations)

`eslint-plugin-security@4.0.1` recommended rules run as **errors** on
`src/**/*.{ts,tsx}`. Initial wiring produced 374 findings; triage outcome:

- `security/detect-object-injection` — **off** (222 findings, all sampled
  false positives: typed-union record lookups like
  `PERMISSION_CAPABILITY[permission]` and numeric array indices like
  `hops[clientIndex]`; the rule cannot distinguish them from user-controlled
  keys). Prototype-pollution mitigation in this codebase is zod-validated
  server boundaries + exhaustive-map `Object.hasOwn` guards (e.g.
  `capability-for-permission.ts`), not this rule. Documented in
  `eslint.config.js` next to the setting.
- Test files (`**/*.test.*`, `test-setup`, `src/shared/testing/**`) — whole
  ruleset **off** (227 findings, all false positives: test code processes no
  untrusted input — fixture fs walks, in-memory repo indexers).
- 8 `detect-unsafe-regex` + 3 `detect-non-literal-fs-filename` production
  findings — individually reviewed false positives (anchored/bounded
  patterns; repo-constant/server-constant paths); each site carries an inline
  per-line disable with `BQC-7.7 (owner: platform)` + reason.
- All 14 `detect-non-literal-regexp` findings were in test files (covered by
  the test relaxation).

### License policy details

Inventory is `pnpm licenses list --json` per tree (verified on pnpm 10.6.5).
Allow-list: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0,
BlueOak-1.0.0, MIT-0, Python-2.0, Unlicense, WTFPL. License **expressions**:
`A OR B` passes when any operand is allowed (we elect it); `A AND B` passes
only when every operand is allowed. The inventory is platform-dependent for
os/cpu-conditional optional packages (e.g. `@img/*-linux-x64` exists on CI,
not on macOS dev machines) — hence trailing-`*` package patterns and
warn-only stale exceptions.

### Container scanning details

`anchore/scan-action` runs grype against every locally built classified image with
`fail-build: true`, `severity-cutoff: high`, pinned `grype-version`. Fixes
land before exceptions: the base digest is bumped deliberately (documented in
the Dockerfile headers) and the **npm CLI is stripped from runtimes that do not
execute package management** (the runtime never installs packages — this cleared all six
npm-bundled findings, including a Critical `tar` advisory). What remains in
`.grype.yaml` is wont-fix/not-fixed Debian triage noise (19 CVEs, no patched
package exists) and Go-stdlib findings inside never-executed esbuild CLI
binaries (in prod `node_modules` only via `better-auth → drizzle-kit`; the
runtime CMD is `node` on pre-built bundles, migrations run the bundled
`migrate-deploy.js` with the drizzle-orm migrator). SARIF output uploads to
code scanning.

### Secret scanning details

gitleaks runs via the official image pinned by digest (`gitleaks-action` is
deliberately not used — it requires an organization license key), in a
separate `secrets` job (not a step in `check`) so the signal stays distinct
in branch protection and runs in parallel without a pnpm install. Checkout
uses `fetch-depth: 0`. Scan scope by event:

- **Pull requests:** the PR range (`origin/<base>..HEAD`) — every commit the
  PR introduces. Measured sub-second-to-minutes; full-history-per-PR was not
  viable (see below).
- **Pushes to main / dispatch:** all refs (`--log-opts=--all`) — the
  full-history net on the merge path. Measured 2026-07-31: **1960 commits /
  7.7 GB in 8m25s, zero findings** (the whole repo history is clean — no
  triage was needed).

The committed `.gitleaks.toml` allowlist is a **performance** measure, not
finding suppression: it skips only two machine-generated committed artifacts
(`.fallow/cache.bin` binary blobs, `graphify-out/graph.json`) that dominated
scan time; each entry carries owner/reason/expiry. Triage rule: a real secret
in history stops the line (rotate + purge — never silence); only verified
placeholder/test fixtures may be allow-listed, per-entry with
owner/reason/expiry comments.

### Migration artifact consistency

Two named gates in the `check` job back to back: "Predeploy migration
parity" (BQC-7.1 — deploy runner converges instantly against the manually
migrated DB) and "Schema drift (model ↔ migrated catalog)"
(`pnpm check:schema-drift` — the semantic comparator against the same
migrated database). Drift or divergence fails the job.

## Alert wiring (`security.scan`)

These gates are the `security.scan` signal source (see
`docs/operations/runbooks.md` alert table): a red gate fails the GitHub check
→ branch protection blocks merge → the check failure notifies on-call through
the repository's GitHub notification routing. There is deliberately no
app-level alert dispatcher for it (CI red is pre-deploy evidence, not a
production signal).
