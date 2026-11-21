# Reputation — Context

## Domain

`domain/` holds the pure types, rules, constructors, events and errors of Review
and Inbox. They are one bounded context (rule 7). It imports no I/O, no framework
and no clock.

Where both had a module for the same job, the name says whose it is:
`review-types.ts`/`inbox-types.ts`, `review-errors.ts`/`inbox-errors.ts`,
`review-rules.ts`/`inbox-rules.ts` and `review-events.ts`/`inbox-events.ts`.
Inbox's constructors and manager priority are `inbox-constructors.ts` and
`inbox-priority.ts`.

Event modules end in `-events.ts`: they are the only domain modules
`src/shared/events` may import.

The Reply workflow's hand-written oracle is `reply-workflow-oracle.test-fixtures.ts`.
`reply-workflow.property.test.ts` here and
`replies/reply-workflow.model.integration.test.ts` use it.

Review's and Inbox's layer code imports these files directly. Other areas reach
them only through `review/application/public-api.ts` and
`inbox/application/public-api.ts`, and feature screens may not import them.

## Feature layout

`inbox/ui/inbox-list.tsx` owns the Inbox list panel, its loading/error/empty
content choice, pagination and selectable rows. Its Storybook states live beside
it in `inbox-list.stories.tsx`; their titles and state names remain stable.

`replies/ui/` owns the browser reply composer: its controller, the autosave
coordinator, the draft session and its context, edit measurement, composer
transitions and the `use-reply-*` hooks, with their tests. The composer
components (the form, editor, dock, footer, suggestion and template menus, the
draft-waiting state and their stories) are in `replies/ui/composer/`, and the
reply as shown in the thread, with its commands and check, is in
`replies/ui/message/`. `use-reply-actions.ts` and its helper
`reply-draft-stream.ts` stay in `src/components/inbox`: the first imports Review
and AI server functions as values and the second a type from an AI `*.server`
module, which the feature-UI import rules refuse, and the Storybook stubs and
the draft session import them from there.

`inbox/ui/` also owns the Inbox detail: the panel and sheet, case toolbar,
conversation thread, notes, history lines, feedback handling, review cause and
correction, the Google check, and the `use-inbox-detail*` hooks, with their
tests and stories.

The Inbox page, queue, filter, row, selection, shortcut and cache primitives are
in `inbox/ui/page/`, with their tests and stories. The Response Target chip and
the deadline refresh that reloads the detail are in `response-targets/ui/`. The
panel receives commands as props and reads browser-safe Inbox types through
`src/contexts/inbox/application/public-api.ts`. Review and Inbox keep their
server functions, builds, public APIs and the few browser-reached files their
maps list; the rest of their code is in the features below. Server functions
remain at their existing `server/` paths.

Each port sits beside its implementation as `<impl>.port.server.ts`. A port
implemented in a build or in composition sits with its callers. Inbox's copies of
Review's authority ports are `inbox/review-*.port.server.ts`.

`response-targets/` owns Response Targets end to end: the stores (`store`,
`policy.store`, `analytics.store` and `reminder-release.store`, each
`*.server.ts`) with their ports; `get-response-targets` and
`set-response-target-policy`; the reminder release decision, the tick
(`reminder-release.server.ts`, `release-reminders.server.ts`) and the
`release-reminders.job.server.ts` scheduler job; `google-review-target-completion`
and the archive consumer; the restated-revision exclusion store and its Review
read; and, in `ui/`, the Organization settings card and analytics summary. The
target rules stay in `domain/response-target.ts`. Inbox's command and projection
code imports these server files directly. Server functions stay in
`src/contexts/inbox/server/`.

## Reply writes

`replies/store.server.ts` builds the Reply writer (`createReplyWriter`): draft
writes and guarded command updates. Each interactive write takes the observation
fence, then locks Review before Reply; a draft save that names the revision it
read is refused when the row has moved. Review owns the `ReplyWriter` port in
`application/ports/reply-writer.port.ts`, supplies its row helpers when it
builds the writer, and receives the writer through its own build. Reputation
reads Review only through `review/application/public-api.ts`.

`replies/scope-effects.server.ts` holds the effects that need no Review helper:
bulk AI-draft withdrawal, restore fencing and Organization closing and scrub.
They run in the caller's transaction and lock Reviews in tenant/id order before
touching Replies. Shared AI purge and restore recovery cannot import a context,
so they take them as a port type declared in `shared/db/reply-scope-effects.ts`
and every entry point that can reach them is handed the writer where it is built.

`replies/contracts.ts` is the browser contract: the revision identity (from
`shared/reply-revision.ts`, also used by Review) and the editor fence that keeps
an active editor bound to it and sequences its own mutations, so background reads
cannot authorize stale text and delayed responses cannot revive a deleted draft.

`replies/row-commands.server.ts` holds the writes that need only the caller's
transaction: the provider mirror refresh and removal, cancellation and
confirmation at an observation, source-change and guest-edit returns to draft,
and AI adoption. Review's stores call them through
`application/public-api.ts` under the Review lock they already hold; the source,
attempt and measurement fences stay in those stores. Nothing outside
`replies/` writes the `replies` table, and `shared/architecture/reply-single-writer.test.ts`
fails on a new writer. Shared code reaches the effects only through the port.
`composition/reply-scope-effects.ts` supplies the writer to the context builds,
the declared-capability deploy step, the AI control, restore-verify and purge
scripts; there is no global binding. An entry point built without it refuses at
the first purge or fence, and `composition/reply-scope-effects.test.ts` proves
each one passes it.

## Provider content

`content/store.server.ts` writes the stable Review identity and the independently
expiring `review_source_contents` row in the observation transaction. Provider
values and renewable fetch clocks are written only to that content row; the nullable old
columns remain in the schema and erasure still clears retained copies. Review's
observation repository keeps material-revision comparison and history, including
the observation text comparison needs. Serving, AI freshness, sync and lifecycle
reads use the content row. Only a provider fetch can renew its expiry. The Review retains its connection
for the database publication guard and its first-fetch history for re-observation
after erasure; neither is served as provider content.

## Inbox commands

`inbox/command-store.server.ts` builds the atomic Inbox command store from
cohorts that share one runtime (`command-runtime.server.ts`: the transaction
authority check and the single-row transition runner): `assignment-commands`
(assign, bulk assign, release and manual reopen), `status-commands` (bulk
reopen, escalation and priority), `note-commands` and `source-commands`
(create, source projection, withdrawal, transition, reply observation and
receipts). Helpers shared with the other Inbox stores sit beside them in
`inbox/` (guards, cycle head, projection, histories, mappers).

## Review sync

`sync/` holds the code that reads Google into Review: `admit-review-sync`
(Integration's entry), discovery and the refresh sweep, provider snapshots and
their runs, head checks, targeted reads, the check of one review on Google,
provider subject keys and their inventory, and the worker runtime
(`review-worker-runtime.server.ts`) that registers the Review jobs. Each job is
`<name>-job.server.ts`. Review's `CONTEXT.md` names every job and what it does.

## Reply publication

`publication/` holds the path from an approved Reply to Google: the publish job
with its pre-read and scope resolver, reconciliation of ambiguous attempts,
dispatch evidence, the Google reply observation store with its fence and clock,
cancellations and `publication-outbox-consumers.server.ts`.

## Reviews

`reviews/` holds the Review record: its repository, command store and Review
writer, the observation repository and its retention, the exact-current
authorities for reply observation, source transition and Response Targets, the
governed reads (eligible reviews, serving stats, Google rating reads and weekly
history) and the AI review source.

## Content lifecycle

`content/` holds provider content lifecycle: the content store, source-content
purge, the lifecycle store and its sweeps, expiry activation, and operator
recovery (evidence, approval and executor).

## Reply library

`library/` holds the manager's voice and templates: the library repository, the
layer operations, the template frame choices and the AI reply frames. The
resolver and its DTO stay in `review/application/`.
