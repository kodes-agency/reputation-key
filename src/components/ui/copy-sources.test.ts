// One list of action copy (UI consistency scan: ACT-08, FORM-17, COLL-21).
//
// A button read "Save Changes" on Profile and "Save changes" on Organization, "New
// Goal" beside "New portal", "Archive Portal" beside "Disconnect this Property", and a
// "Back to Portals" link beside a "Back to properties" one. A label is sentence case
// (see "Action copy" in `components/CONTEXT.md`): the first word capitalised and a
// domain noun a common noun in it. These checks read the labels the sources spell (the
// text of a button, a menu item, a tab, a dialog title; the props that name a control)
// and fail on a capital after the first word, so a Title Case label drifts back
// with the file named. The wordings the sweep replaced are pinned too.
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { readUiSources } from '#/shared/testing/source-tree'

const FILES = readUiSources({ includeTs: true, comments: 'kept' })

/** Elements whose text is a label a person reads as a name for an action or a place. */
const LABEL_TAGS: ReadonlySet<string> = new Set([
  'Button',
  'SubmitButton',
  'AddAction',
  'AddActionLink',
  'ConfirmationTrigger',
  'DropdownMenuItem',
  'RowActionsItem',
  'DialogCancel',
  'DialogTitle',
  'AlertTitle',
  'CardTitle',
  'SectionTitle',
  'TabsTrigger',
  'LinkTab',
  'InlineLink',
  'SelectItem',
  'DropdownMenuLabel',
  'DataTableHead',
  'BreadcrumbPage',
])

/** Props that hold a label. */
const LABEL_PROPS: ReadonlySet<string> = new Set([
  'confirmLabel',
  'cancelLabel',
  'pendingLabel',
  'inheritLabel',
  'overrideLabel',
  'label',
  'aria-label',
  'title',
])

/** Keys whose string is a label in a copy table (a nav item, a back target, a status map). */
const LABEL_KEYS: ReadonlySet<string> = new Set(['label', 'confirmLabel', 'cancelLabel'])

/** Names the product defines, which keep their capitals inside a label. */
const PROPER_NAMES = [
  'Account Admin',
  'Property Manager',
  'Responsible Manager',
  'Google Business Profile',
  'Business Profile',
  'Reputation Key',
  'RepKey',
  'Beta Agreement',
  'Privacy Notice',
  'Data Cell',
]

/** Single words that stay capitalised: a provider, a file format, a key on the keyboard. */
const PROPER_WORDS: ReadonlySet<string> = new Set([
  'Google',
  'OpenAI',
  'WebP',
  'Up',
  'Down',
])

/** A label the sweep leaves, and why. */
const ALLOWED_LABELS: Readonly<Record<string, string>> = {
  'Open page: get its address in Share':
    'names the Share tab, which is a tab of the Portal workspace, inside a hint',
  'Review language · Detect automatically':
    'two labels joined by a dot: the select’s name, then its option',
  'the Organization target':
    'the text of a link inside a sentence of help text, which follows the glossary',
}

function capitalisedAfterTheFirst(label: string): readonly string[] {
  let rest = label
  for (const name of PROPER_NAMES) rest = rest.split(name).join(' ')
  const words = rest.split(/[^A-Za-z]+/u).filter(Boolean)
  const first = label.split(/[^A-Za-z]+/u).find(Boolean)
  return words.filter(
    (word, index) =>
      /^[A-Z][a-z]/u.test(word) &&
      !PROPER_WORDS.has(word) &&
      !(index === 0 && word === first),
  )
}

type Label = Readonly<{ path: string; text: string }>

function labelsOf(path: string, text: string): readonly Label[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const found: Label[] = []
  const add = (value: string) => {
    const label = value.replace(/\s+/gu, ' ').trim()
    if (label !== '') found.push({ path, text: label })
  }
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxElement(node) &&
      LABEL_TAGS.has(node.openingElement.tagName.getText(source))
    ) {
      for (const child of node.children) if (ts.isJsxText(child)) add(child.text)
    }
    if (
      ts.isJsxAttribute(node) &&
      LABEL_PROPS.has(node.name.getText(source)) &&
      node.initializer !== undefined &&
      ts.isStringLiteral(node.initializer)
    ) {
      add(node.initializer.text)
    }
    if (
      ts.isPropertyAssignment(node) &&
      LABEL_KEYS.has(node.name.getText(source)) &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      add(node.initializer.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const LABELS = FILES.filter((file) => !file.path.includes('/__fixtures__/')).flatMap(
  (file) => labelsOf(file.path, file.text),
)

describe('capitalisedAfterTheFirst', () => {
  it('finds a Title Case label and a domain noun with a capital', () => {
    expect(capitalisedAfterTheFirst('Save Changes')).toEqual(['Changes'])
    expect(capitalisedAfterTheFirst('Archive Property')).toEqual(['Property'])
    expect(capitalisedAfterTheFirst('Back to Portals')).toEqual(['Portals'])
    expect(capitalisedAfterTheFirst('Confirm & Publish')).toEqual(['Publish'])
  })

  it('leaves sentence case, a provider and the names the product defines', () => {
    expect(capitalisedAfterTheFirst('Save changes')).toEqual([])
    expect(capitalisedAfterTheFirst('Import from Google')).toEqual([])
    expect(capitalisedAfterTheFirst('Review & publish')).toEqual([])
    expect(capitalisedAfterTheFirst('Account Admin')).toEqual([])
    expect(capitalisedAfterTheFirst('Invite an Account Admin')).toEqual([])
    expect(capitalisedAfterTheFirst('Property settings')).toEqual([])
  })
})

describe('labelsOf', () => {
  it('reads the text of a button, a menu item and the props that name a control', () => {
    const text = `
      const x = (
        <>
          <Button>Save Changes</Button>
          <DropdownMenuItem>Remove from group</DropdownMenuItem>
          <Dialog confirmLabel="Archive Portal" cancelLabel="Keep portal" />
          <p>Not a label of Any Kind</p>
        </>
      )
      const to = { label: 'Back to Portals', to: '/portals' }
    `

    expect(labelsOf('x.tsx', text).map((label) => label.text)).toEqual([
      'Save Changes',
      'Remove from group',
      'Archive Portal',
      'Keep portal',
      'Back to Portals',
    ])
  })
})

describe('a label is sentence case', () => {
  it('has no capital after its first word, outside what the product names', () => {
    const offenders = LABELS.filter(
      (label) =>
        !(label.text in ALLOWED_LABELS) &&
        capitalisedAfterTheFirst(label.text).length > 0,
    ).map((label) => `${label.path}: ${label.text}`)

    expect(offenders).toEqual([])
  })

  it('allows no label that is no longer spelled', () => {
    const stale = Object.keys(ALLOWED_LABELS).filter(
      (allowed) => !FILES.some((file) => file.text.includes(allowed)),
    )

    expect(stale).toEqual([])
  })
})

// The wordings the sweep replaced: a second spelling of the same action.
describe('an action has one wording', () => {
  const REPLACED: ReadonlyArray<readonly [RegExp, string]> = [
    [/Mark all as read/u, '"Mark all read", as the page and the popover say it'],
    [/Enable AI (analysis|replies)/u, '"Turn on …", as the overview says it'],
    [/Import property\b/u, '"Import from Google", as the Properties button says it'],
    [
      /Back to Properties|Back to Portals|Back to Goals/u,
      '"Back to <place>", the place in lower case',
    ],
    [/Save (Property|Portal) target/u, '"Save target"'],
  ]

  it.each(REPLACED)('has no %s', (pattern, instead) => {
    const offenders = FILES.filter((file) => pattern.test(file.text)).map(
      (file) => file.path,
    )

    expect(offenders, `say ${instead}`).toEqual([])
  })

  it('says "Try again", or what it tries again, never "Retry" in a label', () => {
    const offenders = LABELS.filter((label) => /\b(Retry|Retrying)\b/u.test(label.text))

    expect(offenders).toEqual([])
  })

  it('spells no success toast with "successfully" (see feedback-ownership)', () => {
    const offenders = LABELS.filter((label) => /successfully/u.test(label.text))

    expect(offenders).toEqual([])
  })
})
