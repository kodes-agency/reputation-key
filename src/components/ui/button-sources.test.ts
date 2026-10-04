// One Button (UI consistency scan: ACT-03, ACT-05, ACT-10, ACT-13, ACT-16, FORM-15, FORM-18).
//
// The same four jobs were re-done in every file that drew a button: a touch height
// (`min-h-11 md:min-h-8`, `h-11 md:h-9`, `max-md:size-9`: nine per-file constants and
// about a hundred class strings), a pending spinner (six treatments), an icon-only
// button's name and hint, and a focus ring. The Button owns the first two (its sizes
// carry the touch token, and `pending` draws the spinner), `IconButton` the third, and
// `focus-ring` the last. These checks read the sources, so a new constant, a new
// hand-placed spinner or a new icon-only Button fails here with the file named
// instead of drifting back.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const SOURCES = ['src/components', 'src/routes'] as const

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.tsx?$/u.test(entry.name) && !/\.(stories|test)\./u.test(entry.name)
      ? [path]
      : []
  })
}

/** The source without its comments, which are free to quote the old spellings. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1')
}

const FILES = SOURCES.flatMap((source) => walk(join(ROOT, source))).map((path) => ({
  path: relative(ROOT, path),
  text: code(readFileSync(path, 'utf8')),
}))

type SourceFile = (typeof FILES)[number]

const offendersOf = (
  matches: (file: SourceFile) => boolean,
  allowed: Readonly<Record<string, string>> = {},
) => FILES.filter((file) => matches(file) && !(file.path in allowed)).map((f) => f.path)

const staleIn = (
  matches: (file: SourceFile) => boolean,
  allowed: Readonly<Record<string, string>>,
) =>
  Object.keys(allowed).filter(
    (path) => !FILES.some((file) => file.path === path && matches(file)),
  )

/** A Button's opening tag, with its props, up to the `>` that closes it. */
function buttonTags(text: string): string[] {
  const tags: string[] = []
  for (const match of text.matchAll(/<Button\b/gu)) {
    let depth = 0
    let quote: string | null = null
    for (let index = match.index; index < text.length; index += 1) {
      const char = text[index]
      if (quote !== null) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'" || char === '`') quote = char
      else if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0) {
        tags.push(text.slice(match.index, index + 1))
        break
      }
    }
  }
  return tags
}

describe('a control gets its touch height from the primitive', () => {
  /** The recipes a Button, an Input or a menu item re-derived per file. */
  const RECIPE =
    /\bmin-h-11\b[^"'`]*\b(?:sm|md):min-h-[89]\b|h-11 md:h-9|size-11 (?:sm|md):size-[89]|max-md:(?:size|h)-9\b|max-md:min-h-9\b/u
  /** Files where the recipe sizes something that is not a control. */
  const RECIPE_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/inbox/composer-mode-row.tsx': 'the mode segments are tab triggers',
    'src/components/inbox/inbox-case-toolbar.tsx': 'the due chip is a popover trigger',
    'src/components/inbox/reply-draft-origin-tag.tsx':
      'the origin tag is a menu trigger set in a line of text',
    'src/components/features/portal/portal-settings/portal-localized-content-editor.tsx':
      'a disclosure header row that spans the card, not a Button',
    'src/components/features/integration/google-import-manager/google-import-review-row.tsx':
      'the label of a checkbox is its own touch box, not a Button',
  }
  const hasRecipe = (file: SourceFile) => RECIPE.test(file.text)

  it('is the token, not a per-file `min-h-11 md:min-h-8`, `h-11 md:h-9` or `max-md:h-9`', () => {
    expect(offendersOf(hasRecipe, RECIPE_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer has a recipe', () => {
    expect(staleIn(hasRecipe, RECIPE_ALLOWED)).toEqual([])
  })

  it('is not a Button with a fixed height of its own', () => {
    const FIXED = /(?:^|[\s"'`])(?:h|size)-(?:9|10|11|12)(?=[\s"'`])/u
    const offenders = FILES.filter((file) =>
      buttonTags(file.text).some((tag) => FIXED.test(tag)),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })
})

describe('the touch token is the primitives', () => {
  const spellsToken = (file: SourceFile) =>
    /--control-touch/u.test(file.text) && !file.path.startsWith('src/components/ui/')
  const TOKEN_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/inbox/inbox-property-select.tsx':
      "the list header's scope line is a text trigger, not a Button; it sizes itself from the token",
  }

  it('is `touch` or `iconBelow` on a Button, not `--control-touch` in a class', () => {
    expect(offendersOf(spellsToken, TOKEN_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer spells it', () => {
    expect(staleIn(spellsToken, TOKEN_ALLOWED)).toEqual([])
  })
})

describe('a form submits through submitHandler', () => {
  // The wiring copied by hand: prevent the native submit, stop the event, then run
  // the form (or call `handleSubmit` and leave its rejection unhandled).
  const HAND_WIRED =
    /preventDefault\(\)\s*(?:\w+\.)?stopPropagation\(\)\s*void (?:submitForm|\w+\.handleSubmit)\(/u
  const isHandWired = (file: SourceFile) => HAND_WIRED.test(file.text)
  const WIRING_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/forms/form-submit.ts': 'the wiring itself',
  }

  it('is `onSubmit={submitHandler(form)}`, not a copy of it', () => {
    expect(offendersOf(isHandWired, WIRING_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer has the wiring', () => {
    expect(staleIn(isHandWired, WIRING_ALLOWED)).toEqual([])
  })

  it('never calls `handleSubmit` and drops its promise', () => {
    const DROPPED = /\bvoid \w+\.handleSubmit\(\)/u
    expect(offendersOf((file) => DROPPED.test(file.text))).toEqual([])
  })
})

describe('an explanation wears one cue', () => {
  const HAND_TYPED = /decoration-dotted/u
  const hasDotted = (file: SourceFile) => HAND_TYPED.test(file.text)
  const DOTTED_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/ui/explain-trigger.tsx': 'the primitive itself',
    'src/components/features/portal/portal-workspace/portal-workspace-header.tsx':
      'a link to the review page, not an explanation',
  }

  it('is `EXPLAIN_UNDERLINE` or `ExplainTrigger`, not a dotted underline typed by hand', () => {
    expect(offendersOf(hasDotted, DOTTED_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer types one', () => {
    expect(staleIn(hasDotted, DOTTED_ALLOWED)).toEqual([])
  })
})

describe('a pending button is the Button', () => {
  const draws = (file: SourceFile) =>
    /<Button\b/u.test(file.text) && /animate-spin/u.test(file.text)
  /** A spinner drawn for something that is not a button's pending state. */
  const SPINNER_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/ui/region-error.tsx':
      'Try again stays aria-disabled, not disabled, so keyboard focus is kept',
    'src/components/features/integration/google-import-manager/google-import-progress-view.tsx':
      'the refresh icon of a progress heading spins while it reads',
    'src/components/features/integration/google-import-manager/google-import-progress-items.tsx':
      'the status glyph of a progress row, beside a Retry that is a pending Button',
    'src/components/inbox/composer-mode-row.tsx': 'a status glyph in the mode row',
    'src/components/ui/load-more-button.tsx':
      'Load more is aria-disabled while it loads, not disabled, so keyboard focus stays in the popover; a pending Button is natively disabled',
  }

  it('is `pending`, not a hand-placed spinner beside a Button', () => {
    expect(offendersOf(draws, SPINNER_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer draws a spinner beside a Button', () => {
    expect(staleIn(draws, SPINNER_ALLOWED)).toEqual([])
  })

  it('has no inert data-icon attribute: the Button already places and sizes its icon', () => {
    expect(offendersOf((file) => /data-icon=/u.test(file.text))).toEqual([])
  })
})

describe('an icon-only control is an IconButton', () => {
  /** Reachable from the first-paint closure, where the tooltip primitives are not (the bundle budget). */
  const ICON_BUTTON_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/layout/theme-toggle.tsx':
      'the public header is first paint; it keeps a title',
    'src/components/features/notification/notification-panel.tsx':
      'the bell is first paint (the public header mounts it)',
    'src/components/features/notification/notification-sheet-header.tsx':
      "the bell's could-not-load body is first paint, on purpose",
    'src/components/ui/dialog-close-button.tsx':
      'the corner close of every dialog and sheet; the beta launcher mounts a Dialog in first paint',
  }
  const hasIconOnlyButton = (file: SourceFile) =>
    buttonTags(file.text).some(
      (tag) => /size="icon(?:-sm|-xs|-lg)?"/u.test(tag) && /aria-label=/u.test(tag),
    )

  it('is not a square Button with only an aria-label', () => {
    expect(offendersOf(hasIconOnlyButton, ICON_BUTTON_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer has one', () => {
    expect(staleIn(hasIconOnlyButton, ICON_BUTTON_ALLOWED)).toEqual([])
  })
})

describe('a control that is not a Button still has the Button focus ring', () => {
  /** The ring the Button wears, spelled out; `focus-ring` is the shared utility. */
  const OLD_RING = /focus-visible:ring-2 focus-visible:ring-ring/u
  const hasOldRing = (file: SourceFile) => OLD_RING.test(file.text)
  const RING_ALLOWED: Readonly<Record<string, string>> = {}

  it('is `focus-ring`, not a 2px ring in another weight', () => {
    expect(
      offendersOf(hasOldRing, RING_ALLOWED).filter((path) => !path.includes('/guest/')),
    ).toEqual([])
  })

  it('lists no file that no longer spells the old ring', () => {
    expect(staleIn(hasOldRing, RING_ALLOWED)).toEqual([])
  })
})

describe('a link set in a sentence is an InlineLink', () => {
  const HAND_TYPED = /text-link underline-offset-4/u
  const hasHandTyped = (file: SourceFile) => HAND_TYPED.test(file.text)
  const HAND_TYPED_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/ui/inline-link.tsx': 'the primitive itself',
    'src/components/ui/button.tsx': 'the link variant',
    'src/components/ui/badge.tsx': 'the link variant',
  }

  it('is not typed by hand', () => {
    expect(offendersOf(hasHandTyped, HAND_TYPED_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer types one by hand', () => {
    expect(staleIn(hasHandTyped, HAND_TYPED_ALLOWED)).toEqual([])
  })
})

describe('a tooltip has one provider', () => {
  const mountsProvider = (file: SourceFile) => /<TooltipProvider\b/u.test(file.text)
  const PROVIDER_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/ui/sidebar.tsx':
      'SidebarProvider wraps the whole authenticated shell: it is the app-level provider',
  }

  it("is the shell's, not one per feature with a delay of its own", () => {
    expect(offendersOf(mountsProvider, PROVIDER_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer mounts one', () => {
    expect(staleIn(mountsProvider, PROVIDER_ALLOWED)).toEqual([])
  })
})
