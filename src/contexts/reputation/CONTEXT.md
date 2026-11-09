# Reputation — Context

## Feature layout

`inbox/ui/inbox-list.tsx` owns the Inbox list panel, its loading/error/empty
content choice, pagination and selectable rows. Its Storybook states live beside
it in `inbox-list.stories.tsx`; their titles and state names remain stable.

`replies/ui/` owns the browser reply composer: its controller, the autosave
coordinator, the draft session and its context, edit measurement, composer
transitions and the `use-reply-*` hooks, with their tests. `use-reply-actions.ts`
stays in `src/components/inbox`, where the feature-UI import rules and the
Storybook stubs expect it; the composer components also stay there.

`inbox/ui/` also owns the Inbox detail: the panel and sheet, case toolbar,
conversation thread, notes, history lines, feedback handling, review cause and
correction, the Google check, and the `use-inbox-detail*` hooks, with their
tests and stories.

The Inbox page, queue, filter and row primitives remain in `src/components/inbox`. The panel
receives commands as props and reads browser-safe Inbox types through
`src/contexts/inbox/application/public-api.ts`. Review and Inbox still own their
server implementations, wiring and contracts in their existing contexts; see
their area maps. Server functions remain at their existing `server/` paths.

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
