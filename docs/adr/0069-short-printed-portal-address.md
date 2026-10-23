---
status: accepted
date: 2026-10-23
---

# 0069 — Short printed Portal address

Amends [ADR 0044](0044-public-portal-and-guest-response.md) ("Token and session"
decision 1 and the printed-kit rule of its 2026-10-01 amendment),
[ADR 0064](0064-sealed-portal-address-and-download-again.md) (decisions 1, 5 and 7,
and its rejected alternative "Derive the address from a secret and the token id"),
and the Portal CONTEXT invariant 9, each by a dated note that points here.

## Context

A printed QR and an NFC tag carry the Portal's long address, `pt_<16>_<43>`
behind the app origin. On the beta, which prints from
`web-closed-beta-v2.up.railway.app`, that is 159 characters: a version 9 QR symbol
(0.833 mm modules in the 2 in tile) and 159 bytes on an NFC tag, 15 bytes more than
an NTAG213 holds (144). The round-3 print sizes (Table, the small tent, Mini) need
a version 3 symbol: at 1.25 in a version 9 symbol has modules of 0.52 mm, and the
print kit's module floor is 0.85 mm. The owner's decision D7 of 2026-10-22 was "no shorter
printed token"; on 2026-10-23 the owner reversed it ("Yes, plan a short print
address (D7) so Table, the tent and Mini can ship") and chose the host:
`https://ap.up.railway.app`.

Three things bind the answer. ADR 0044 stores only a keyed hash of a token, and
ADR 0064 added one sealed copy of an active code's address, read by one repository
and recorded before every disclosure. The guest page and every guest mutation check
the request's `Origin` against the app origin by exact match
(`src/contexts/guest/server/public.ts`), so the page cannot simply be served from a
second host. And a printed code cannot be fixed after it is printed: its length and
alphabet are the card's for life, so the entropy has to be right the first time.

## Decision

1. **The print host is a redirect, not a second site.** `ap.up.railway.app` (17
   characters) is attached to the beta's web service as a second Railway domain.
   `web-closed-beta-v2.up.railway.app` stays `BETTER_AUTH_URL`, the app origin.
   `PORTAL_PRINT_ORIGIN` (non-secret; https in production, no path) names the print
   host, and boot refuses a host longer than 25 characters, which is the longest
   that keeps the QR address a version 3 symbol. On that host `GET` and `HEAD` for
   `/p/<anything>` answer 302 to the same path and query on the app origin, with
   `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; every other path
   is a 404 with no body, and nothing logs a path. The target origin is fixed and
   only `/p/` redirects, so it is not an open redirect. The guest page is not served
   on the print host, for the `Origin` reason above. If the owner later makes the
   print host the app's main URL, the print host equals the app host and the
   redirect turns off; print codes then resolve on `/p/$token` directly, which is
   why the code works with both.
   **A Railway-provided name is never released, renamed or detached once anything
   is printed with it.** Another Railway account could claim a released name and
   receive every scan. The runbook (§26) says the same.
2. **A print code is its own credential.** It is 20 Crockford base32 characters
   (`0-9 A-H J K M N P-T V-Z`, 100 bits). A print code carries at least 96 bits, and
   a longer one is allowed, a shorter one is not. A code row has two print codes,
   one per access-artifact channel (QR and NFC). The QR string is
   `HTTPS://AP.UP.RAILWAY.APP/p/<code>`: 48 characters, version 3 at error
   correction M (the lowercase form is version 4). The scheme and host are
   uppercase to stay in the QR alphanumeric set; `/p/` stays lowercase because the
   guest cookie path is case-sensitive. A reader may fold the case of the path, so
   the server accepts either case.
3. **Derivation uses two subkeys of the server secret, one job each.** There is no
   new secret.
   ```
   kDerive = HMAC-SHA256(PORTAL_TOKEN_HASH_SECRET, "rk-print-code-derive-key/v1")
   kHash   = HMAC-SHA256(PORTAL_TOKEN_HASH_SECRET, "rk-print-code-hash-key/v1")
   mac     = HMAC-SHA256(kDerive, channel + "|" + accessArtifactId + "|" + rawLongToken)
   code    = Crockford32(first 100 bits of mac)
   stored  = hex(HMAC-SHA256(kHash, code))
   ```
   The raw long token is in the message, so the server secret alone produces
   nothing, and a holder of the long website address can derive nothing (the long
   token has 256 secret bits, so the code is uniform and says nothing about it). The
   `/v1` is the format of the subkeys. **Print codes are bound to the first secret
   for life:** every printed code would otherwise stop matching its stored hash. Any
   future dual-secret scheme must keep that secret for print codes, and a change of
   `PORTAL_TOKEN_HASH_SECRET` kills them as it already kills every long address.
4. **Input is normalised ASCII-first.** The raw input must match
   `^[0-9A-Za-z]{20}$` before anything else, so `ſ`, `ı`, `ﬁ` and fullwidth digits,
   which uppercasing or normalising would turn into ASCII, are not print codes.
   Then it is uppercased, `O` reads as `0` and `I`, `L` as `1`, and the result must
   match `^[0-9A-HJKMNP-TV-Z]{20}$` (`U` is not in the alphabet). The long shape
   contains `_`, so the two shapes never overlap. `digest()` stays long-only; a
   print code has its own digest.
5. **Only keyed hashes are stored, on `portal_tokens`.** Migration 0070 adds
   nullable `qr_print_code_hash` and `nfc_print_code_hash` (64 lowercase hex, a
   CHECK each) with a partial unique index each. They sit on `portal_tokens`, which
   is not exported and not queried, and not on `portal_access_artifacts`, which is
   exported: credential material stays out of the export. The matching column says
   which channel was scanned. A hash is looked up only by the page repository, the
   access-artifact repository, the Portal command store and the address repository
   (`portal-print-code-columns.test.ts`).
6. **A print code lives and dies with its code row.** Issue derives both codes from
   the new long token and the two new artifact ids and stores both hashes in the
   existing transaction. A planned replacement gives the new row two new hashes;
   the old row becomes `rotating` and keeps its own, so old short prints open and
   count until the grace ends. A security replacement has grace 0 and stops them at
   once. Stopping every code and deleting a Portal revoke the row. A unique
   violation at issue or replace is the typed error `print_code_collision`, with no
   retry (the odds are about 2^-59); the manager presses the button again.
7. **"Download again" derives the print codes again.** The sealed copy is still the
   long token (ADR 0064 decisions 1 and 7); it is not widened and there is no second
   sealed copy. The reveal unseals it and derives the same codes. A stored hash that
   is null is filled by one `UPDATE ... COALESCE` with the tenant predicates, an
   idempotent write of a derived value like the download audit row, so it needs no
   revision fence: two racing reveals write the same value. If the stored hash
   differs from the derived one, or any fill fails, the reveal returns the long form
   for that channel, reports a content-free error and never fails. This is how
   every live code gets its print codes, lazily, the first time it is printed or
   downloaded; there is no backfill command.
8. **The reveal now returns three addresses**, `qr`, `nfc` and `direct` (ADR 0064
   decision 5 returned two), still from a no-store POST. Issue and replace carry the
   same three and gain `Cache-Control: private, no-store` before anything else can
   fail. `qr` and `nfc` are the short forms when a print code exists, the long
   forms otherwise. `direct` is always the long address with no marker: "Public
   address" and "Open page" use it, so the manager's own visit never counts as a QR
   scan.
9. **Resolution is the same query; attribution comes from the code.** A print code
   resolves through the registered public-token query with its three digest
   equalities replaced by `(qr_print_code_hash = $h OR nfc_print_code_hash = $h)`,
   under the same active-or-grace rule, so every guest path (page, mutations, link
   clicks, the scan beacon) accepts it. A scan counts when the server derives the
   marker from the print code: the channel is the column that matched, and a claimed
   `?accessArtifact=` that differs is not counted. A long token with no marker keeps
   today's refusal (`access_artifact_missing`) and never reaches the artifact
   lookup, so website visits and "Public address" visits are still not scans.
10. **Print codes are credentials under invariant 9.** The code and its hash never
    enter state, facts, events, logs, exports, Metric or Sentry. The field-name
    policy names `printCode`, `printCodeHash` and `shortCodeHash` and the suffixes
    `printcode` and `codehash`. A derive mismatch and a collision are reported as
    content-free error classes. There is no miss limiter: 100 bits is the control,
    and a per-IP limit would not stop a residential address pool anyway.
11. **Minting waits for the host.** This decision ships in steps. The schema, the
    codec and the field policy ship first and are dark. Resolution and the redirect
    deploy next, so both hosts can resolve a print code before one exists. Minting
    and showing ships only after the print host is attached, and after a real print
    passes a phone test of the uppercase address on current and old cameras. If the
    uppercase form fails on casing only, the builder switches to the lowercase form
    (version 4); the codes stay valid because the server folds case.

## Consequences

- Every printed short code depends on `ap.up.railway.app` for the life of the print:
  it stays attached and keeps its name. Once short codes are printed, the resolution
  and redirect steps are never rolled back (they would stop printed codes and tags
  opening); a fault is fixed forward. Minting alone can be rolled back, and printed
  codes keep resolving. The migration is never reverted: the columns are harmless to
  older code.
- A scan costs one extra round trip through the redirect.
- A print code is as powerful as the long address for one thing only: it opens the
  public guest page and lets a visit be counted. It reveals nothing private. A guess
  that hit would send ratings into one venue's funnel; at 100,000 guesses a second
  for ten years against a million live codes the expected number of hits is about
  5 x 10^-11.
- A suspected compromise is handled as before, and a security replacement kills the
  print codes with the long address.
- Platform access logs hold `/p/<code>` on both hosts, the same class of data as
  `/p/<token>`; retention is an operations check.
- The 96-bit floor is permanent: a shorter code is not a fallback for a longer
  host. The print kit (a later step) refuses a size whose modules would fall below
  0.85 mm, with a cause that says whether the code or the host is too long.
- `PORTAL_PRINT_ORIGIN` is optional, so nothing changes where it is unset; it is set
  on web and worker with the step that adds the redirect.

## Rejected alternatives

- **A shorter code.** Ten base62 characters (59.5 bits) and twelve Crockford
  characters (60 bits, the most that fits version 3 on the Railway host) would give
  about 80 and about 60 expected hits in ten years under the same assumptions.
  Entropy is the one thing that cannot be fixed after printing.
- **Serve the guest page on the print host.** The guest `Origin` check is an exact
  match against the app origin, so the page would load and every guest action would
  fail. Loosening the check to a list of origins widens the security boundary for
  no gain a redirect does not give.
- **Print short codes from the app host.** On `web-closed-beta-v2.up.railway.app`
  (33 characters) the QR address is 64 characters, version 4 at best, and Mini
  cannot ship. The print host is also a Railway-provided name, but a short one, and
  because it only redirects, a later move of the app changes the redirect target and
  not the cards.
- **A new table with a second sealed copy and its own cipher format.** Deriving
  from the sealed long token gives the same Download again with no new format.
- **Keying the derivation with the raw long token alone**, or with one key for both
  jobs. Two subkeys of the server secret, with the long token in the message, keep
  each key to one job and make the server secret and the long token both needed.
- **Moving the whole app to a short custom domain.** It signs every manager out,
  changes the Google OAuth redirect and the storage CORS origin, and still needs a
  redirect for the old host. The print host leaves that choice to the owner.
- **A miss limiter on short-code lookups.** Limiter keys need the resolved Portal,
  and a per-IP limit does not stop a distributed guesser; 100 bits does.
