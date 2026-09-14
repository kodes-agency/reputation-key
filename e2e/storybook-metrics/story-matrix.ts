// The vocabulary of the declared matrix — widths, windows, pane selectors and
// the shape of a group — shared by `inbox-detail-stories.ts` (the pane's
// regions and sheets) and `inbox-detail-compositions.ts` (the compositions and
// the parts rendered alone), and the derivation both feed.
//
// ── Why a story's widths are declared, not all three for everyone ───────────
//
// Most of these stories draw their pane at a FIXED width, as an inline style,
// because an arbitrary Tailwind width would be inert in the Vitest project
// (`inbox-case-toolbar.stories.tsx:280-296`, `inbox-thread.stories.tsx:636-650`,
// `reply-composer.stories.tsx:780-810`). The desktop story is a 720 px box and
// its twin (`…390`, `…Phone`, `…At390`) a 390 px box. Loaded at another width
// the box does not follow the window:
//
//   - a 720 px box at 390 is a document that scrolls by 330 px — a failure of
//     the harness, not of the product;
//   - a 390 px box at 1440 lays the members out at DESKTOP size, because
//     `max-md:` reads the window, not the box — so the phone rule would be
//     measured against the desktop classes and pass on nothing;
//   - the twins' plays assume their width (`reply-composer.stories.tsx`
//     `onPhone` arrives through the collapsed bar, which only exists below
//     `md`) and throw at the other one.
//
// So each story is measured at the width its box was drawn for: the 720 px
// stories at 1440 (the desktop split the pane is 720 of), the 390 px twins at
// 390. The 320 px run belongs to the stories whose pane FOLLOWS the window —
// the mobile sheet (`inbox-detail-sheet.tsx`, `w-full`), the collapsed-
// composer harness, the page's own sheet, and the parts rendered alone with no
// width of their own (a reply node, the reply editor, the footer, the note
// form) — which is also where 320 is real: it is the narrowest viewport
// `accessibility.spec.ts` reflows at, and the sheet is the only surface the
// page mounts below `md`. A part that follows the window at every width, and
// plays at every width, is measured at all three (`EVERY_WIDTH`).
//
// ── Why the pane is a selector per group ────────────────────────────────────
//
// The rules apply to the PANE, not the story: several stories put harness
// controls beside the component (`composer-dock.stories.tsx` `Submit the
// reply`, `reply-composer-collapsed.stories.tsx` `Select next item` and `Clear
// the saved draft`), and those are neither in the product nor sized for a
// thumb. Harness controls INSIDE the component, in its slots, are a different
// problem with a different answer — see `standIns` below. Each selector is the
// smallest element that is the component under test:
//
//   toolbar   `section[aria-label="Case status"]` — its accessible name, which
//             `inbox-mobile-390.stories.tsx` already addresses by role;
//   thread    the element whose child is `Timeline` (`inbox-thread.tsx:428`);
//   region    region 4's `@container/reply-workspace` (`reply-composer.tsx:84,
//             105`). It is a class because region 4 has no other handle, and
//             `reply-composer.tsx:71-77` says the name may be dropped one day.
//             If it is, every composer run fails with "no visible pane
//             matched" — loudly, never as a silent pass;
//   sheet     `SheetContent`'s `data-slot` (`ui/sheet.tsx:55`). Not
//             `[role=dialog]`: a Radix popover is a dialog too;
//   detail    the pane's own column, the element whose child is the case toolbar
//             (`inbox-detail-content.tsx`) — for PAGE stories, where the list
//             panel beside it is out of scope (plan: "Out of scope");
//   story     the story's own root, for stories that render ONLY the component
//             (the footer alone, the assist group alone, the desktop panel, a
//             reply node, the reply editor);
//   form      the same, for a component whose root is a `form` (the note form).
//

export type StoryWidth = 320 | 390 | 1440

/**
 * The three windows. 568 is the short phone PR 4 measured the dock at
 * (`composer-dock-rows.ts`: "or its primary can be pushed below a 568 px
 * viewport"); 844 is the `mobileStaff` phone the sheet is designed at
 * (`.storybook/preview.tsx`); 900 is `desktopManager`.
 */
export const VIEWPORTS: Readonly<
  Record<StoryWidth, Readonly<{ width: number; height: number }>>
> = {
  320: { width: 320, height: 568 },
  390: { width: 390, height: 844 },
  1440: { width: 1440, height: 900 },
}

export const PANE = {
  toolbar: 'section[aria-label="Case status"]',
  thread: 'div:has(> [data-slot="timeline"])',
  region: '[class*="@container/reply-workspace"]',
  sheet: '[data-slot="sheet-content"]',
  story: '#storybook-root > div',
  form: '#storybook-root > form',
  detail: 'div:has(> section[aria-label="Case status"])',
} as const

export type MeasuredStory = Readonly<{
  id: string
  widths: ReadonlyArray<StoryWidth>
  pane: string
  requiresPrimary: boolean
  judgesTargets: boolean
  /** As `judgesTargets`, once the harness has opened the pane's disclosures. */
  judgesOpenedTargets: boolean
}>

export type Group = Readonly<{
  prefix: string
  pane: string
  widths: ReadonlyArray<StoryWidth>
  stories: ReadonlyArray<string>
  /**
   * Stories that must show region 4's primary (`COMPOSER_PRIMARY_NAMES`). A
   * primary that IS on screen is always checked; this makes its ABSENCE a
   * failure too, so a regression that unmounts the primary cannot pass as a
   * story with nothing to check. Every list was read off a green run.
   * `{ allBut }` names the few stories of a group whose final frame has none.
   */
  withPrimary?:
    ReadonlyArray<string> | 'all' | Readonly<{ allBut: ReadonlyArray<string> }>
  /**
   * The component's slots hold story stand-ins, not product (see the dock
   * groups). Overflow and the primary's position are judged; target sizes are
   * not, because the stand-ins were never sized for a thumb.
   */
  standIns?: true
  /**
   * The component is product until the harness opens it, and stand-ins after:
   * a collapsed dock story shows only the bar, and opening the bar reveals the
   * story's stand-in slots. Target sizes are judged before, not after.
   */
  standInsOnceOpened?: true
}>

export const DESKTOP: ReadonlyArray<StoryWidth> = [1440]
export const PHONE: ReadonlyArray<StoryWidth> = [390]
export const FOLLOWS_THE_WINDOW: ReadonlyArray<StoryWidth> = [320, 390]
/** Every width, for a component whose box follows the window at all three. */
export const EVERY_WIDTH: ReadonlyArray<StoryWidth> = [320, 390, 1440]

/** Where an inbox story is defined, as `/index.json` spells `importPath`. */
export const INBOX_STORY_IMPORT_PREFIX = './src/components/inbox/'

const requiresPrimary = (group: Group, name: string): boolean => {
  const declared = group.withPrimary
  if (declared === undefined) return false
  if (declared === 'all') return true
  if ('allBut' in declared) return !declared.allBut.includes(name)
  return declared.includes(name)
}

export const measuredStories = (
  groups: ReadonlyArray<Group>,
): ReadonlyArray<MeasuredStory> =>
  groups.flatMap((group) =>
    group.stories.map((name) => ({
      id: `${group.prefix}${name}`,
      widths: group.widths,
      pane: group.pane,
      requiresPrimary: requiresPrimary(group, name),
      judgesTargets: group.standIns !== true,
      judgesOpenedTargets: group.standIns !== true && group.standInsOnceOpened !== true,
    })),
  )

/**
 * Declaration mistakes the type system cannot see: a `withPrimary` name that
 * is not one of its group's stories would silently require nothing, and a
 * story declared twice at one width would be two tests with one title.
 */
export const declarationErrors = (
  groups: ReadonlyArray<Group>,
  measured: ReadonlyArray<MeasuredStory>,
): ReadonlyArray<string> => [
  ...groups.flatMap((group) => {
    const declared = group.withPrimary
    const named =
      declared === undefined || declared === 'all'
        ? []
        : 'allBut' in declared
          ? declared.allBut
          : declared
    return named
      .filter((name) => !group.stories.includes(name))
      .map(
        (name) =>
          `withPrimary names ${group.prefix}${name}, which its group does not measure`,
      )
  }),
  ...measured.flatMap((story, index) =>
    story.widths
      .filter((width) =>
        measured
          .slice(0, index)
          .some((earlier) => earlier.id === story.id && earlier.widths.includes(width)),
      )
      .map((width) => `${story.id} is declared twice at ${width} px`),
  ),
]
