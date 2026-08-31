---
status: accepted
date: 2026-08-28
---

# 0060 — Machine-checked legal approval

## Context

The program states plainly that engineering cannot self-approve the legal gate,
and Gate F requires a counsel approval bound to an exact legal revision set.
Until now that rule lived only in prose. Three things followed from that.

First, nothing detected drift. The Privacy Notice, the Closed Beta
Participation Agreement and the Google Business Profile Access Disclosure are
Markdown files. Once counsel signed a version, any later edit — a typo fix, a
reformat by the formatter, a well-meant clarification — would silently
invalidate that approval with no signal.

Second, code could not tell a draft from an approved document. The three
counsel-owned documents are internally aligned v2 candidate drafts, not
publishable legal documents, but any code path that wanted to claim "legal
approval exists" had nothing to consult and would have had to assume.

Third, Gate F's `legalRevisionSet` was a fail-open. It required an evidence
reference, but nothing checked that the documents behind that reference were
actually approved, unexpired and digest-accurate. A draft could have satisfied
the counsel gate.

Counsel review is external and slow. That is a reason to make the repository
side mechanical, not a reason to leave it informal.

## Decision

Legal approval is represented as data and enforced by code.

**A registry is the single authority.** Every document under `docs/legal/`
carries an id, kind, version, path, status, SHA-256 over its exact bytes, and —
when approved — an effective date, approver, approval evidence reference,
review-due date and expiry. The registry lives in TypeScript so the runtime can
read it without reaching into `docs/`, and is mirrored to
`docs/legal/legal-document-registry.json`; a test asserts the two are
byte-identical, so editing one without the other fails.

**The validator fails closed, in both directions.** An approved document whose
bytes changed after approval is rejected. So is a draft whose digest has gone
stale — drafts must stay digest-accurate, because counsel must review the exact
bytes they were sent. An approved document that still carries a
non-publishable marker is rejected, and so is a draft that has lost one. An
expired approval is rejected. An unregistered document under `docs/legal/` is
rejected, which is how a new document gets noticed rather than ignored.

**Self-approval is refused by name.** An approver whose role is not external
counsel, or whose name appears in the self-approval prohibition, is rejected.
`requireApprovedLegalDocument` throws for a draft and names the blocking id, so
no code path can claim an approval that does not exist. All three counsel-owned
documents are registered as drafts with a null approver today, and a test
asserts that the approved set is empty — a future flip to approved is therefore
a diff a human must justify.

**The open decisions are addressable.** Nine categories — roles, lawful bases,
rights, DPIA and regions, retention classes, processors and transfers, Google
terms and expiry, staff metrics, support terms — are extracted from four
documents into a structured checklist. Every item carries the question, its
source document, a verbatim anchor that must actually occur in that document,
the repository fact that constrains the answer, and the documents it blocks. A
document cannot be marked approved while an item blocking it is still open.

**Gate F consumes the validated result.** The typed legal revision set is bound
to the candidate, and an absent, stale, draft-carrying or self-approved set
makes Gate F validation fail. The producer refuses to emit while any
counsel-owned document is a draft, so running it today exercises the
fail-closed path rather than producing an artifact.

## Consequences

The repository can now state its legal position honestly and mechanically:
five registered documents, five drafts, zero approvals, three publication
blockers. That is the output of `pnpm check:legal-registry`, which runs in
`lint:ci` and on push.

Counsel's job becomes mechanical rather than archaeological: a fixed list of
decisions, each anchored to the sentence that raises it and the code fact that
constrains it.

The cost is that editing a legal document now requires updating its digest in
two places. That is the intended friction. A legal document whose bytes can
change without anyone noticing is not evidence.

This ADR does not decide any legal question. It decides how an answer, once
counsel gives one, is recorded and enforced.
