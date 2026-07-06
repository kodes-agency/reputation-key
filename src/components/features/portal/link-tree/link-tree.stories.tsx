// UN-STORYABLE: LinkTree cannot be rendered in the Storybook preview without a
// non-story-file change, so this file documents the blocker instead of forcing a
// broken story.
//
// Blocker — server-core leak (same class as the stubbed
// `#/contexts/review/server/reply`):
//   LinkTree → useLinkTreeState → useLinkTreeMutations, which VALUE-IMPORTS 8
//   server fns from `#/contexts/portal/server/portal-links` (createLinkCategory,
//   updateLinkCategory, deleteLinkCategory, reorderCategories, createLink,
//   updateLink, deleteLink, reorderLinks). That module imports `createServerFn`
//   from `@tanstack/react-start` AND `getContainer` from `#/composition` (the DI
//   composition root — DB/infrastructure). Importing it in the browser preview
//   leaks server-only Node code and crashes the preview, exactly like
//   review-reply-server did before it got a stub in `.storybook/stubs/`.
//
// Why the inbox pattern doesn't apply:
//   `inbox-page-v2` takes its server fns as a PROP (`inboxFns`) and wraps them
//   in the client-side `useServerFn`, so the inbox-page story injects an
//   in-memory fn bundle with no module-level server import. LinkTree has NO
//   fn-injection seam — `useLinkTreeMutations()` value-imports the portal-links
//   module unconditionally at call time. There is nothing to override from a
//   story.
//
// Secondary blocker — permissions:
//   LinkTree and several children call `usePermissions()` →
//   `useRouteContext({ from: '/_authenticated' })`, which the global
//   `RouterDecorator` does not provide (it only registers `/`). Solvable with a
//   story-local auth router (see people-page.stories.tsx), but only AFTER the
//   server-core leak is resolved.
//
// Fix path (requires touching non-story files — out of scope for this pass):
//   1. Add `.storybook/stubs/portal-links.ts` exporting the 8 fns as no-op /
//      in-memory mock implementations (mirror `review-reply-server.ts`), returning
//      the `{ category }` / `{ link }` shapes `useLinkTreeState` consumes.
//   2. Alias `#/contexts/portal/server/portal-links` → that stub in
//      `.storybook/main.ts` `viteFinal`.
//   3. Re-write this file: import LinkTree, render seed categories + links, add
//      a CategoryAddForm play fn (type a name → submit → assert the new category
//      appears), wrapped in an auth-role decorator. Do NOT attempt real
//      @dnd-kit drag (dnd-kit is a client lib and renders fine; assert render +
//      the add-category flow only).
//
// This note renders as a placeholder story so the gap is visible in the Docs UI.

import type { Meta, StoryObj } from '@storybook/react'

function UnStoryableNote() {
  return (
    <div className="rounded-lg border border-dashed p-6 text-sm">
      <p className="mb-2 text-base font-semibold">LinkTree — not storyable (yet)</p>
      <p className="text-muted-foreground">
        Value-imports 8 portal-link server fns via <code>useLinkTreeMutations</code>,
        leaking <code>@tanstack/react-start</code> + <code>#/composition</code> into the
        browser preview. Needs a <code>.storybook/stubs/portal-links.ts</code> stub +{' '}
        <code>main.ts</code> alias before it can render. See the file comment for the full
        fix path.
      </p>
    </div>
  )
}

const meta: Meta<typeof UnStoryableNote> = {
  title: 'Portal/LinkTree',
  component: UnStoryableNote,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof UnStoryableNote>

export const UnStoryable: Story = {}
