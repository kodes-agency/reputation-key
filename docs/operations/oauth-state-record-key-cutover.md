# OAuth state record-key cutover

The provider-ephemeral key that holds an OAuth ceremony record is now derived
through the `GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS` keyring
(`google-oauth-state-record-key` audience, the handle's own key version) instead
of a bare SHA-256 digest of the handle. This closes a code/decision divergence:
ADR 0050 §5 already specifies that Provider Redis holds the record "under an
audience-separated HMAC".

## Why the unkeyed derivation was wrong

The handle is the OAuth `state` value. It is sent to Google in a redirect URL
and comes back in another, so it survives in browser history, `Referer`
headers, proxy and CDN access logs, and any analytics that captures query
strings. Under the unkeyed digest, anyone who obtained one of those copies
could compute the exact `provider-ephemeral:{oauth-state}:<key>` location
holding that ceremony's PKCE code verifier and OIDC nonce — no secret required.
Keying the derivation means a leaked `state` is no longer sufficient on its
own; the keyring secret is also needed.

Redemption still fails closed for a leaked handle on the session/user/
organization binding. The keyed derivation removes the _read_ of the verifier
material, not just its redemption.

This reason stands on its own and does not depend on any scanner. Treat the
CodeQL section below as a separate, weaker claim.

## CodeQL `js/insufficient-password-hash`: verified location, unverified closure

Two things must not be conflated here, because an earlier review conflated them
and reached a wrong conclusion.

**Verified — the removed expression is where the alert points.** Code-scanning
alert #14 is pinned to commit `4d531c9791cf79b972a4853f90b9e61cdb5e779e` on
`refs/heads/main`, at `src/contexts/integration/application/oauth-state-handle.ts`
line 76, columns 38-44, with the message "Password from a call to sign is hashed
insecurely." Resolved **against that commit** (not against branch HEAD), line 76
is `return createHash('sha256').update(handle).digest('base64url')` and columns
38-44 are the `handle)` argument. That is exactly the expression this change
removed. Reproduce with:

```sh
gh api "repos/:owner/:repo/code-scanning/alerts?state=open&per_page=100" \
  --jq '.[] | select(.rule.id | test("password-hash")) |
        {rule: .rule.id, path: .most_recent_instance.location.path,
         line: .most_recent_instance.location.start_line,
         commit: .most_recent_instance.commit_sha,
         msg: .most_recent_instance.message.text}'
git show <commit>:<path> | awk 'NR==<line>'
```

Note the source/sink split in that message: the _source_ is the `sign(...)`
call, and the _sink_ is the `createHash`. `deps.handleKeys.sign(...)` is
untouched by this change and is not supposed to be — removing the sink is what
was in scope.

**Corrects an in-repo record.** `docs/release-evidence/review/comprehensive-progress-report-2026-08-29.md`
states that both `js/insufficient-password-hash` alerts "point at line numbers
that no longer contain the flagged code (`oauth-state-handle.ts:76` is a type
declaration; `composition.ts:597` is unrelated)". The premise that the alerts
are pinned to an older commit is right; the conclusion is wrong. Those line
numbers were read against branch HEAD rather than against each alert's own
`commit_sha`. Read against `4d531c9`, both land on the flagged code exactly —
`composition.ts:597` is
`const fallbackKey = createHash('sha256').update(env.OAUTH_STATE_SECRET).digest('hex')`,
matching its own message "Password from an access to OAUTH_STATE_SECRET is
hashed insecurely." Always resolve a code-scanning line number against
`most_recent_instance.commit_sha`.

**Not verified — that the alert closes.** No CodeQL analysis was run for this
change; there is no `codeql` CLI on the authoring machine and the workflow
(`.github/workflows/codeql.yml`) runs only on `main` pushes, PRs to `main`, the
weekly cron, and `workflow_dispatch`. Removing the flagged expression is
necessary but not demonstrably sufficient: the new derivation routes the same
handle through `createHmac('sha256', key)` in
`src/shared/security/versioned-hmac-keyring.ts`, and HMAC-SHA256 is not a
password-hashing KDF (bcrypt/scrypt/argon2/PBKDF2), so the same query may model
it as a sink too. Weak counter-evidence: `sign()` and `verify()` already reach
that identical `createHmac` line and were not flagged at `4d531c9`. That is
suggestive, not proof.

**Do not record this alert as fixed on the strength of this change.** Confirm
against a real scan of this branch — dispatch the CodeQL workflow, or wait for
the PR run — and only then update the alert's status. `composition.ts:597` is a
separate open alert that this change does not touch.

## Transition: clean cut, no legacy read path

Records written by a pre-cutover release are unreachable after the deploy.
This is accepted rather than bridged.

- The window is bounded by the record's own TTL. `issue` writes with
  `ttlSeconds = 600` and `expiresAtMs = nowMs + 600_000`, so no record outlives
  ten minutes. Orphans expire on their own; there is nothing to clean up.
- The affected set is every ceremony whose `issue` and whose callback are served
  by different versions — and during a rolling deploy that happens in **both**
  directions, because this repo deploys with a rolling overlap it explicitly
  designs for (see `docs/operations/railway-data-cells.md`, "old and new
  processes can each resolve their own binding during a later rolling overlap").
  An old replica issues under the SHA-256 key and a new replica reads the HMAC
  key; a new replica issues under the HMAC key and an old replica reads the
  SHA-256 key. Both miss. So the blast radius is not only "issued before the new
  code served" — while both versions are serving, any issue/callback pair that
  straddles them fails, in either order. Size it from the overlap duration and
  connect rate, not from the cutover instant.
- The failure is `not_found`, which `handleGoogleOAuthCallback` turns into
  `/properties/import-google?error=connection_failed`. No token exchange
  happened, so there is no partial or duplicate connection; the user clicks
  Connect again.

### Why not bridge the window

Not because bridging is large. A correct bridge is small: `redeem` already
funnels the read, the expiry `remove`, the tombstone `replaceIfEquals` and the
race re-read through a single `key` local, so binding that local to whichever
key the record was actually found under bridges all four sites in roughly six
lines and needs no signature change. An earlier write-up claimed bridging "would
mean threading the discovered key through the whole redemption path, which is a
materially larger change than the ten-minute window justifies" — that cost basis
is wrong and is withdrawn.

The reason is security, and it is sufficient on its own: any legacy read path
keeps the guessable key live for as long as it exists. During the overlap, a
`state` value leaked through browser history, a `Referer` header, or an access
log would still resolve straight to that ceremony's PKCE verifier and OIDC
nonce — which is the entire exposure this change exists to close. It would also
put the unkeyed digest back in the tree.

A read-**only** fallback — the cheap version, without rebinding the key — is
additionally wrong on its own terms, and was measured against this suite: the
record is found under the legacy key, but the tombstone `replaceIfEquals`
targets the derived key, so the CAS misses and a valid in-flight ceremony is
reported as `replayed` instead of completing. Do not reach for it as a
shortcut.

`oauth-state-handle.test.ts` → "does not fall back to the pre-cutover unkeyed
record key" stages a record under the legacy key and asserts `not_found`, so
the absence of a fallback is a locked behaviour rather than an omission.

## Deploy note

Prefer a deploy window with low connect volume, and keep the rolling overlap as
short as the platform allows — the overlap, not the cutover instant, is what
sets the blast radius. There is no migration, no backfill, and no operator
command. Rollback is redeploying the previous image, which reopens the same
window in both directions again and restores the unkeyed key. Do not roll back
for `not_found` reports alone; they drain within ten minutes of the rollout
finishing.

Key rotation is unaffected. Derivation uses the key version carried in the
handle, so ceremonies issued under a retained version stay readable for as
long as that version is retained — the same bound that already governs handle
verification.
