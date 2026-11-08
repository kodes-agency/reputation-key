# Reputation — Context

## Feature layout

`inbox/ui/inbox-list.tsx` owns the Inbox list panel, its loading/error/empty
content choice, pagination and selectable rows. Its Storybook states live beside
it in `inbox-list.stories.tsx`; their titles and state names remain stable.

The Inbox page and row primitives remain in `src/components/inbox`. The panel
receives commands as props and reads browser-safe Inbox types through
`src/contexts/inbox/application/public-api.ts`. Review and Inbox still own their
server implementations, wiring and contracts in their existing contexts; see
their area maps. Server functions remain at their existing `server/` paths.
