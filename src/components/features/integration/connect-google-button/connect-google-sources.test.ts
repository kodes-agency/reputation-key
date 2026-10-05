// One way to start a Google authorization (UI consistency scan: FORM-13, ACT-09).
//
// "Connect Google" was a Button with a spinner on the import page and two bespoke
// Buttons with a Plus and a renamed "Connecting…" label on the Integrations page, with
// Reauthorize and Show account email written out again with a failure sentence of their
// own. These checks read the sources, so a second place that fetches the sign-in
// address and redirects to it, or a second wording of the button, fails here with the
// file named instead of drifting back.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..')
const SOURCES = ['src/components', 'src/routes'] as const
const BUTTON =
  'src/components/features/integration/connect-google-button/connect-google-button.tsx'

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

describe('a Google authorization starts from ConnectGoogleButton', () => {
  /** Going to the address the server gave: the end of the ceremony's first step. */
  const REDIRECTS_TO_THE_URL = /window\.location\.href\s*=\s*(?:\w+\.)?url\b/u
  const redirects = (file: SourceFile) => REDIRECTS_TO_THE_URL.test(file.text)

  it('is the only place that redirects to the sign-in address', () => {
    expect(FILES.filter(redirects).map((file) => file.path)).toEqual([BUTTON])
  })

  it('catches both spellings the scan found', () => {
    expect(REDIRECTS_TO_THE_URL.test('window.location.href = url')).toBe(true)
    expect(REDIRECTS_TO_THE_URL.test('window.location.href = result.url')).toBe(true)
    expect(REDIRECTS_TO_THE_URL.test('window.location.href = "/login"')).toBe(false)
  })

  it('has one wording: no "Connect Google Account" and no "Connecting…" label swap', () => {
    const second = (file: SourceFile) =>
      /Connect Google Account|pendingLabel="Connecting…"/u.test(file.text)

    expect(FILES.filter(second).map((file) => file.path)).toEqual([])
  })

  it('is what the import page, the Integrations page and a connection row draw', () => {
    const users = FILES.filter((file) => /<ConnectGoogleButton\b/u.test(file.text)).map(
      (file) => file.path,
    )

    expect(users.sort()).toEqual([
      'src/components/features/integration/google-import-manager/google-import-manager-view.tsx',
      'src/components/features/settings/google-connection-settings-row.tsx',
      'src/components/features/settings/integrations-settings-page.tsx',
    ])
  })
})
