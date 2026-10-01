---
status: accepted
date: 2026-10-01
---

# 0064 — Sealed Portal address and "Download again"

Amends [ADR 0044](0044-public-portal-and-guest-response.md), "Token and session"
decision 1, and the Portal CONTEXT invariant 9.

## Context

A Portal has one public address, and its code is that address twice over: a QR
image and an NFC tag. ADR 0044 stores only a keyed hash of the token, and the
raw address was shown exactly once, when a code was made or replaced. The owner
decision of 2026-09-30 is that managers can download an existing code again.
That needs the raw address to be recoverable by the server, which is a change to
what we are willing to store.

The hash stays the only thing public resolution reads. Recovering the address
must not widen what a leaked database row, an export, a log line or an event
reveals, and it must leave a trace of who was handed what.

## Decision

1. **The raw address may be stored, sealed.** When a keyring is configured,
   issuing or replacing a code stores `portal_tokens.encrypted_raw_token` and
   `address_encryption_key_version` beside the hash. The format is AES-256-GCM
   with a 12-byte random IV, laid out `iv:tag:ciphertext` (base64), and the
   authenticated data is `[format, organization, property, portal, token id,
token version]`. A ciphertext copied to another tenant, Portal, token or
   version does not open. It is the third ciphertext format in the tree
   (`portal-address-cipher.ts`) and is registered as an owner in
   `ciphertext-format-singleton.test.ts`.
2. **The keyring is optional and versioned.** `PORTAL_ADDRESS_ENCRYPTION_KEYS`
   is `<version>:<64 lowercase hex>[,...]` with at most four entries. The first
   entry seals, every entry opens, and a malformed value fails boot. Web and
   worker read the same value. Without it nothing changes: the address is shown
   once, when a code is made, and the "Save this address now" warning stays. The
   page offers "Download again" only for a live code whose sealed copy was made
   with a key the keyring still holds, so a retired key turns the button off for
   that code until it is replaced instead of failing at the click.
3. **Only an active code keeps a readable address.** Replacing a code clears the
   outgoing code's two columns in the same statement that moves it to
   `rotating`; stopping every code and deleting a Portal clear them in the same
   statement that revokes. The CHECK `portal_tokens_sealed_address_active_only`
   makes the database refuse anything else, so a code path that forgets cannot
   leave a readable address behind.
4. **A disclosure is recorded before it happens.** `revealPortalAddress`
   authorises (`portal.update`, the same permission as making a code), finds the
   sealed copy, inserts a `portal_address_downloads` row, and only then
   decrypts. The insert is one statement that selects from the token row and
   writes nothing unless the code is still active and still sealed, so a row
   never describes a stopped code. A request that cannot disclose writes no row.
   A row means an authorised request to disclose, not that the browser used the
   result. The row holds identifiers, an enum and a time, never the address. The
   enum says what the manager did with what they were handed: `download` (saved
   a code file), `copy` (put an address on the clipboard) or `show` (only had
   it displayed).
5. **The surface is narrow.** The server function is a POST, so the address never
   travels in a URL, and it sets `Cache-Control: private, no-store` before
   anything else can fail. It spends an actor budget (30 per hour) and an
   Organization budget (200 per day) at the trust boundary, actor first, and the
   production limiter fails closed. The response carries the same two URLs issue
   and replace return, rebuilt from the published QR and NFC markers.
6. **Provenance is recorded.** `portal_tokens.issued_by` records who made a code
   (null before this change), and History names that person and lists each
   download.
7. **The address stays out of everything else.** `portal_tokens` is still not
   exported and not read except by the one sealed-address repository. The export
   carries the download rows, never the token id that joins to the secret.
   Events carry identifiers only; there is no download event. Purging an
   Organization deletes the download rows before the tokens.
8. **The new invariant 9.** The raw address is request-local, except as the
   sealed copy of an active code. It never appears in state read by anything but
   the reveal path, in facts, in logs, in exports or in Metric.

## Consequences

- A database dump now contains something that opens with the keyring. The
  keyring is a secret of the same class as `ENCRYPTION_KEY`: it lives in the
  runtime environment, is checked against the placeholder family at production
  boot, and follows the rotation steps in the runbook. Losing it costs the
  ability to download existing codes again, not the codes themselves; replacing
  a code makes a fresh sealed copy.
- Compromising the keyring plus a database read exposes the live addresses of
  every sealed Portal. The remedy already exists and is unchanged: replace the
  code for security, which stops the old one at once and clears its sealed copy.
- Rotating a key means adding the new key first and keeping the old one until
  every live code was replaced (or accepting that those codes cannot be
  downloaded again).
- **A release below this one is not a safe rollback once codes are sealed.**
  Migration 0046 adds the CHECK of decision 3, and migrations only go forward.
  An image from before this release replaces, stops and deletes codes without
  clearing the sealed copy, so the database refuses those statements for every
  sealed code and "Stop all codes" fails. A forward deploy is safe because
  nothing is sealed until ops set the keyring; a rollback has no such guard. The
  runbook's "Rolling back below this release" step is therefore mandatory:
  unset the keyring on web and worker, redeploy both, clear every sealed copy,
  and only then deploy the older image. The cost is that those codes can no
  longer be downloaded again; the codes themselves keep working.
- The ratcheted `portal-command-store.ts` is untouched apart from clearing the
  two columns on delete.

## Rejected alternatives

- **Store the address in the clear.** One leaked row would be a working address
  for every Portal.
- **Derive the address from a secret and the token id.** Then the hash and the
  address are the same secret, and rotating the secret rotates every printed
  code.
- **Record the download after the decrypt.** A failure between the two would
  disclose without a trace.
- **A separate "view" permission.** Whoever can make a code can already replace
  it and get its address, so a narrower permission would only add a second place
  to keep in step.
