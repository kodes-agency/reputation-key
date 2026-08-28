# AI personalized Reply Drafting compatibility

Reply Drafting uses the stable `reply-suggestion-v1` operation wrapper and the
current `reply-draft-v2` output profile. Migration
`0163_ai_reply_brand_profile_grounding` adds the public Property Brand Profile
binding; it does not activate a merchant capability, provider, route,
deployment, or Data Cell.

## Grounding and data boundary

The AI context reads the current Property Brand Profile only through Portal's
narrow public authority. That authority returns exactly:

- `displayName`;
- the positive profile `version`; and
- the SHA-256 display-name digest derived from the canonical domain separator.

The provider request contains the exact `displayName` and no other Brand or
Portal content. Logo and hero-image URLs, palette colors, localized public
content, Portal overrides and links, Guest ratings and Private Feedback never
cross the AI boundary. The gateway reconstructs the provider payload from its
closed schema and rejects additional fields.

The operation binding and request fingerprint pin the exact profile version and
display-name digest. Admission compares that immutable binding with the
operation and calls Portal's content-minimal currentness authority under the
same PostgreSQL transaction. The generation use case checks the profile before
and after provider work, and settlement repeats the transaction-bound check.
A changed or missing profile therefore cannot produce a deliverable suggestion.

## Ephemeral suggestion and adoption

Provider request, provider response and generated reply text remain
session-ephemeral. Successful settlement stores only content-minimal operation,
usage and lineage facts. It does not store the reply text.

A manager deliberately adopts the suggestion through Review. Review verifies
the signed provenance and its existing Material Review Revision, source epoch,
source revision, authorization, reply-state revision and expiry fences. For a
grounded suggestion it also asks Portal's boolean authority to revalidate the
exact Brand Profile version/digest inside the same adoption transaction. Review
does not query or own Portal tables. A stale profile atomically marks the pending
operation invalidated and writes no Reply draft.

After adoption, the draft is manager-owned Review content. A later Brand Profile
change does not retroactively invalidate or block that adopted draft; its signed
Brand provenance remains immutable history.

Adoption creates an ordinary editable, AI-assisted Review-owned draft. It does
not submit, confirm, publish, close Inbox work, or change attribution. The draft
continues through the same Confirm & Publish and provider-reconciliation path as
manager-authored text.

## Version compatibility

Verification remains compatible with all issued token generations:

| Provenance               | Reply profile         | Brand binding                                 | Status                  |
| ------------------------ | --------------------- | --------------------------------------------- | ----------------------- |
| `ai-reply-provenance-v1` | stock-template legacy | none                                          | verify/adopt compatible |
| `ai-reply-provenance-v2` | `reply-draft-v1`      | none                                          | verify/adopt compatible |
| `ai-reply-provenance-v3` | `reply-draft-v2`      | exact profile version and display-name digest | current issuer          |

The verifier keeps the historical `reply-draft-v1` digest as a literal pin;
changing the current profile cannot reinterpret an old token. Prefix/version
cross-aliases and any token-field modification fail verification.

## Before promotion

1. Migrate a new empty PostgreSQL database through the complete journal and run
   the schema-drift check.
2. Prove `assert_ai_runtime_catalogue_ready_v1` with the release-pinned provider,
   runtime and operation-profile digests.
3. Prove the admission authority accepts an exact current Brand binding and
   denies a missing, changed or mismatched version/digest without provider work.
4. Prove Portal currentness, AI settlement and Review adoption against real
   PostgreSQL, including a profile change between generation and adoption.
5. Prove v1/v2 verification compatibility and v3 round-trip/tamper rejection.
6. Prove the provider payload contains only the admitted Review fields and exact
   display name, and that outputs mentioning ungrounded facts or the wrong
   display name are rejected.
7. Keep capability/provider activation controls unchanged until the separate
   release decision and required external evidence are complete.

## Forward restoration path

Rollback may disable new Reply Drafting while preserving adopted Reply history.
Do not rewrite migration 0163 or remove v1/v2/v3 verification support. A binary
rollback to code that does not understand grounded operations is safe only after
confirming there are no active grounded operations and no pending grounded
suggestions. Adopted `reply-draft-v2` rows remain valid historical data and must
not be deleted to make an older binary start.

Any catalogue restoration must be a new reviewed forward migration. It must
replace the complete immutable `reply-suggestion-v1` catalogue row, re-emit the
exact readiness assertion, retain the Brand columns and constraints, and retain
all provenance/freshness compatibility branches. Disabling the capability is
the preferred immediate recovery control; the manual Reply workflow remains
available.
