// One Dialog, one ConfirmationDialog (UI consistency scan: SURF-02, SURF-03,
// SURF-06, SURF-07, ACT-15, ACT-17, FORM-02, FORM-16).
//
// The same jobs were re-done in every file that drew a dialog: a confirmation
// assembled from AlertDialog parts (twenty files, three confirm colours, a pending
// label that could never show), a width and a height bound spelled per dialog, a
// Cancel in ghost or outline or absent, and a dismissal guard written by hand in
// three of them and in none of the rest. The primitives own those now (`size`,
// `busy`, `DialogCancel`, `ConfirmationDialog`). These checks read the sources, so
// a new hand-assembled confirmation, a width typed on a DialogContent or a Cancel
// built from a Button fails here with the file named instead of drifting back.

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

/** An opening tag with its props, up to the `>` that closes it. */
function tagsNamed(text: string, name: string): string[] {
  const tags: string[] = []
  for (const match of text.matchAll(new RegExp(`<${name}\\b`, 'gu'))) {
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

/**
 * A width or a height bound typed on a DialogContent instead of `size`, or a
 * padding instead of the `--dialog-pad` variable the pinned footer reaches over.
 */
const RECIPE =
  /(?:^|[\s"'`])(?:sm:|md:|lg:)?(?:max-(?:w|h)-|p[xytrblse]?-)|overflow-y-auto/u
const CANCEL_BUTTON = />\s*Cancel\s*<\/(?:Button|DialogClose)>/u
/** An `onOpenChange` that decides by a pending flag is the guard, written by hand. */
const HAND_GUARD = [
  /onOpenChange=\{[^}]*\b(?:isPending|isPublishing|isBusy|pending)\b/u,
  /if \(!\w+ && \w*[pP]ending\)/u,
] as const

describe('a confirmation is the ConfirmationDialog', () => {
  const importsAlertDialog = (file: SourceFile) =>
    /from '#\/components\/ui\/alert-dialog'/u.test(file.text)
  const ALERT_DIALOG_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/ui/confirmation-dialog.tsx': 'the shell every confirmation uses',
  }

  it('is not assembled from AlertDialog parts', () => {
    expect(offendersOf(importsAlertDialog, ALERT_DIALOG_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer imports AlertDialog', () => {
    expect(staleIn(importsAlertDialog, ALERT_DIALOG_ALLOWED)).toEqual([])
  })

  it('does not paint its own confirm button destructive', () => {
    const handPainted = (file: SourceFile) =>
      /<ConfirmationDialog\b/u.test(file.text) &&
      /bg-destructive|text-destructive-foreground|text-white/u.test(file.text)

    expect(offendersOf(handPainted)).toEqual([])
  })
})

describe('a dialog gets its width and height from the primitive', () => {
  const hasRecipe = (file: SourceFile) =>
    tagsNamed(file.text, 'DialogContent').some((tag) => RECIPE.test(tag))
  const RECIPE_ALLOWED: Readonly<Record<string, string>> = {}

  it('is `size`, not a `sm:max-w-*`, a `max-h-*`, an `overflow-y-auto` or a `p-*` per dialog', () => {
    expect(offendersOf(hasRecipe, RECIPE_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer has a recipe', () => {
    expect(staleIn(hasRecipe, RECIPE_ALLOWED)).toEqual([])
  })

  it('also keeps the recipe out of a class a DialogContent is handed by name', () => {
    const named = (file: SourceFile) =>
      /<DialogContent\b/u.test(file.text) &&
      /const [A-Z_]+ =\s*['"`][^'"`]*(?:max-w-|max-h-)/u.test(file.text)

    expect(offendersOf(named)).toEqual([])
  })
})

describe('a dialog footer', () => {
  const buildsCancel = (file: SourceFile) =>
    /<DialogFooter\b/u.test(file.text) && CANCEL_BUTTON.test(file.text)
  const CANCEL_ALLOWED: Readonly<Record<string, string>> = {}

  it('cancels with DialogCancel, not a Button of its own in ghost, outline or nothing', () => {
    expect(offendersOf(buildsCancel, CANCEL_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer builds one', () => {
    expect(staleIn(buildsCancel, CANCEL_ALLOWED)).toEqual([])
  })
})

describe('a dialog that is committing something cannot be dismissed', () => {
  /** An `onOpenChange` that decides by a pending flag is the guard, written by hand. */
  const guardsByHand = (file: SourceFile) =>
    /onOpenChange=\{[^}]*\b(?:isPending|isPublishing|isBusy|pending)\b/u.test(
      file.text,
    ) || /if \(!\w+ && \w*[pP]ending\)/u.test(file.text)
  const GUARD_ALLOWED: Readonly<Record<string, string>> = {}

  it('is `busy` on the Dialog or `useDialogBusy` in its body, not a guard in the handler', () => {
    expect(offendersOf(guardsByHand, GUARD_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer guards by hand', () => {
    expect(staleIn(guardsByHand, GUARD_ALLOWED)).toEqual([])
  })
})

describe('the checks catch the spellings the scan found', () => {
  it('a width typed on a DialogContent', () => {
    const tags = tagsNamed(
      '<DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">x</DialogContent>',
      'DialogContent',
    )
    expect(tags.some((tag) => RECIPE.test(tag))).toBe(true)
    expect(
      tagsNamed('<DialogContent size="lg" className="grid-rows-2">', 'DialogContent')
        .map((tag) => RECIPE.test(tag))
        .includes(true),
    ).toBe(false)
  })

  it('a padding typed on a DialogContent, not the dialog variable', () => {
    for (const className of ['p-4 sm:p-6', 'px-3', 'pe-8']) {
      const [tag = ''] = tagsNamed(
        `<DialogContent className="${className}">x</DialogContent>`,
        'DialogContent',
      )
      expect(RECIPE.test(tag), className).toBe(true)
    }
    const [variable = ''] = tagsNamed(
      '<DialogContent className="[--dialog-pad:1rem] sm:[--dialog-pad:1.5rem] placeholder-x pointer-events-none">',
      'DialogContent',
    )
    expect(RECIPE.test(variable)).toBe(false)
  })

  it('a Cancel built from a Button, ghost or outline', () => {
    expect(
      CANCEL_BUTTON.test('<Button variant="ghost" onClick={onClose}>Cancel</Button>'),
    ).toBe(true)
    expect(CANCEL_BUTTON.test('<DialogClose asChild><Button>Cancel</Button>')).toBe(true)
    expect(CANCEL_BUTTON.test('<DialogCancel />')).toBe(false)
  })

  it('a dismissal guard in the handler', () => {
    const guarded = [
      'onOpenChange={(open) => (open || isPublishing ? undefined : onClose())}',
      'onOpenChange={(next) => {\n if (!next && pending) return\n changeOpen(next) }}',
    ]
    for (const source of guarded) {
      expect(HAND_GUARD.some((guard) => guard.test(source))).toBe(true)
    }
    expect(HAND_GUARD.some((guard) => guard.test('<Dialog busy={isPending}>'))).toBe(
      false,
    )
  })
})
