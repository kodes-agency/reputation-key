# Re-signing Google Content approvals for the closed beta

Google Content capability approvals are Ed25519 role-signed and byte-pinned to
the compiled contract. When an approval-bound value moves — most often
`GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION` — every persisted approval stops
resolving and `property.import_gbp_v2` / `property.read_gbp_performance` deny
`approval_unavailable` until a freshly signed bundle is installed.

This happened on 2026-08-31: the deployed binding pinned route catalogue
`2026-08-16`, the compiled code required `2026-08-27`, and `web` and `worker`
refused to boot with `Google Content runtime bindings are invalid`.

Two commands. The first is yours alone — it needs your keystore password and a
TTY, and nobody else can run it.

## 1. Sign

```bash
pnpm ops:google-content-approval-sign \
  --operator <your-id> \
  --reason "route catalogue <version>" \
  --ticket <ref>
```

**Requirements**

- **A TTY.** The password is read raw and never echoed, so this cannot run in
  CI or from an agent. That is deliberate.
- **Your keystore password.** `.secrets/google-content-approval-roles.enc.json`
  already exists (created 2026-08-19). Reusing it keeps the same Ed25519 role
  keys, so the `GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON` already deployed
  still verifies — no key rotation, no public-key update. Minimum 12 characters.
- **A reachable `DATABASE_URL`.** It reads `capability_compliance_approvals` to
  re-sign the CURRENT approved facts; it never mints new evidence. `Postgres16`
  has no public proxy, so either add a temporary TCP proxy or run the command
  through `railway ssh`.

It signs all five roles — `engineering/runtime`, `product/property`,
`security/privacy`, `google-project/integration`, `operations/on-call`. For the
closed beta the code deliberately reuses one approver identity across all five.

Output lands in `.secrets/google-content-approval-bundles/`: one bundle per
capability plus `role-public-keys.json`. Nothing is written to the database or
to Railway — `--apply` is blocked in that command by design.

## 2. Install

```bash
pnpm ops:closed-beta-google-content \
  --public-keys .secrets/google-content-approval-bundles/role-public-keys.json \
  --bundle .secrets/google-content-approval-bundles/property-import_gbp_v2.json \
  --bundle .secrets/google-content-approval-bundles/property-read_gbp_performance.json
```

Report-only. It verifies every bundle with the same parser, signature verifier
and validator the production controller uses, applies the set-level rules, and
prints the capabilities, route catalogue and expiry. Add `--apply` to write
`GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON` and
`GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON` to `web` and `worker`, then:

```bash
railway redeploy --service web --environment google-closed-beta --yes
railway redeploy --service worker --environment google-closed-beta --yes
```

## Why a second installer exists

`scripts/release/railway-google-content-approval-activation.ts` is the governed
one, and it stays governed. It addresses exactly one target — project
`reputation-key-us-beta`, environment `cell-us` — checked against the canonical
single-US foundation readback. The closed beta is neither, so signed bundles
had nowhere to go: `ops:google-content-approval-sign` could produce artifacts
that nothing could consume.

Widening the production controller was the wrong fix. Its foundation readback is
a real release control and the closed beta has a different service set, so
relaxing it would have weakened the check guarding the production cell to serve
a posture that is not it.

`ops:closed-beta-google-content` therefore **refuses at any posture but
`closed-beta`** (`CURRENT_RELEASE_POSTURE`, `src/shared/release/release-posture.ts`).
At `open-beta` or `ga` it exits pointing at the governed controller. It reuses
the signature and expiry validation unchanged and adds only set-level rules:
one deployment, one owner, one route catalogue, no duplicate capability.

One deliberate difference: the production installer requires all four
capability bundles because all four are in scope for the production cell. The
runtime schema marks each capability optional and requires at least one, and the
closed beta has approval rows for two. This path mirrors the runtime.

## Expiry

Approvals carry a 29-day window (the validator caps it at 30). The install
command prints `expiresAt`; when it passes, the capabilities go dark again and
you repeat step 1. Nothing else expires with them.

## Related

- `docs/adr/0050-*` — provider material handling
- `src/shared/auth/google-content-approval.ts` — parser, verifier, validator
- `src/shared/release/closed-beta-google-content-activation.ts` — set-level rules
