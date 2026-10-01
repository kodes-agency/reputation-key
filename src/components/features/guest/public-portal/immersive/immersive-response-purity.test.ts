// The immersive response view must stay a pure view, like `GuestPageView`:
// nothing it renders may bind a server function or an action. The container
// (slice 19) binds them and hands the finished state in.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('ImmersiveResponseView purity', () => {
  const SRC = fileURLToPath(new URL('../../../../../', import.meta.url))
  const ENTRY = fileURLToPath(new URL('./immersive-response-view.tsx', import.meta.url))
  const RUNTIME_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+'([^']+)'/gm

  function resolveSource(from: string, specifier: string): string | null {
    const base = specifier.startsWith('#/')
      ? join(SRC, specifier.slice(2))
      : specifier.startsWith('.')
        ? resolve(dirname(from), specifier)
        : null
    if (base === null) return null
    return (
      ['.tsx', '.ts', '/index.tsx', '/index.ts']
        .map((extension) => base + extension)
        .find((candidate) => existsSync(candidate)) ?? null
    )
  }

  function viewTree(): Map<string, string> {
    const tree = new Map<string, string>()
    const queue = [ENTRY]
    for (let file = queue.pop(); file; file = queue.pop()) {
      if (tree.has(file)) continue
      const source = readFileSync(file, 'utf8')
      tree.set(file, source)
      for (const [, specifier] of source.matchAll(RUNTIME_IMPORT)) {
        const next = resolveSource(file, specifier ?? '')
        if (next && next.startsWith(SRC + 'components/')) queue.push(next)
      }
    }
    return tree
  }

  it('reaches the cards of both layouts', () => {
    const files = [...viewTree().keys()].map((file) => file.slice(SRC.length))
    expect(files).toEqual(
      expect.arrayContaining([
        'components/features/guest/public-portal/immersive/immersive-rating-card.tsx',
        'components/features/guest/public-portal/immersive/immersive-google-card.tsx',
        'components/features/guest/public-portal/immersive/immersive-note-card.tsx',
      ]),
    )
  })

  it('imports no server function, action hook, controller or legacy v1 copy', () => {
    for (const [file, source] of viewTree()) {
      const name = file.slice(SRC.length)
      expect(source, name).not.toMatch(/useServerFn|useAction|createServerFn/)
      expect(source, name).not.toMatch(/from '#\/contexts\/[^']*\/server/)
      expect(source, name).not.toContain('use-guest-response-controller')
      expect(source, name).not.toContain('guest-language-pack')
    }
  })

  it('pulls in no TanStack Form, shadcn control or app-themed component', () => {
    for (const [file, source] of viewTree()) {
      const name = file.slice(SRC.length)
      expect(source, name).not.toMatch(/@tanstack\/react-form/)
      expect(source, name).not.toMatch(/from '#\/components\/(ui|forms)\//)
    }
  })
})
