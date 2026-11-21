import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LAYOUT,
  explainLayoutRegressions,
  layoutCounts,
  listSourceFiles,
  runLayoutGate,
  type Layout,
} from './check-layout'
import { compareWithBaseline } from './ratchet-baseline'

const ROOT = resolve(import.meta.dirname, '../..')

/** A small map, so each case names only the places it is about. */
const MAP: Layout = {
  ...LAYOUT,
  areas: { portal: ['editor', 'links'], review: [] },
  crossAreaScreens: ['property-setup'],
  sharedFolders: ['db', 'domain'],
}

describe('layout: places the map names', () => {
  it('accepts a file in each place the layout names', () => {
    const files = [
      'src/start.ts',
      'src/start.test.ts',
      'src/routes/_authenticated/inbox/index.tsx',
      'src/composition/web-container.ts',
      'src/worker/index.ts',
      'src/contexts/CONTEXT.md',
      'src/contexts/portal/CONTEXT.md',
      'src/contexts/portal/build.ts',
      'src/contexts/portal/build-print-kit.ts',
      'src/contexts/portal/build-print-kit.integration.test.ts',
      'src/contexts/portal/public-api.ts',
      'src/contexts/portal/domain/portal.ts',
      'src/contexts/portal/server/portals.ts',
      'src/contexts/portal/links/contracts.ts',
      'src/contexts/portal/links/link-targets.contracts.ts',
      'src/contexts/portal/links/CONTEXT.md',
      'src/contexts/portal/links/link-store.server.ts',
      'src/contexts/portal/links/link-store.integration.test.ts',
      'src/contexts/portal/links/links.test-fixtures.ts',
      'src/contexts/portal/links/link-catalogue.json',
      'src/contexts/portal/links/ui/link-list.tsx',
      'src/contexts/portal/links/ui/link-list.stories.tsx',
      'src/contexts/portal/links/ui/rows/link-row.tsx',
      'src/components/CONTEXT.md',
      'src/components/ui/button.tsx',
      'src/components/features/property-setup/setup-wizard.tsx',
      'src/shared/CONTEXT.md',
      'src/shared/db/schema/portal.schema.ts',
    ]

    expect(layoutCounts(files, MAP)).toEqual({})
  })
})

describe('layout: folders that only shrink', () => {
  it('counts the files left in an area’s layer folders', () => {
    const files = [
      'src/contexts/portal/application/use-cases/create-link.ts',
      'src/contexts/portal/application/dto/link.dto.ts',
      'src/contexts/portal/infrastructure/repositories/link.repository.ts',
      'src/contexts/portal/ports/link.port.ts',
    ]

    expect(layoutCounts(files, MAP)).toEqual({
      'src/contexts/portal/application': 2,
      'src/contexts/portal/infrastructure': 1,
      'src/contexts/portal/ports': 1,
    })
  })

  // A regression test for old code must stay possible: only production files
  // hold a folder's count up.
  it('does not count a test or a story in a folder that only shrinks', () => {
    const files = [
      'src/contexts/portal/application/use-cases/create-link.test.ts',
      'src/contexts/portal/infrastructure/repositories/link.repository.integration.test.ts',
      'src/components/inbox/reply-composer.stories.tsx',
      'src/shared/reply-revision.test.ts',
    ]

    expect(layoutCounts(files, MAP)).toEqual({})
  })

  it('counts screens kept outside their area, and admits the cross-area ones', () => {
    const files = [
      'src/components/inbox/reply-composer.tsx',
      'src/components/features/portal/portal-list-page.tsx',
      'src/components/features/portal/portal-list-page.stories.tsx',
      'src/components/features/property-setup/setup-wizard.tsx',
    ]

    expect(layoutCounts(files, MAP)).toEqual({
      'src/components/inbox': 1,
      'src/components/features/portal': 1,
    })
  })

  it('counts loose files and undeclared folders in src/shared', () => {
    const files = [
      'src/shared/reply-language-catalogue.ts',
      'src/shared/merchant-ai-notice-contract.ts',
      'src/shared/reply-library/builtin-library.ts',
      'src/shared/domain/money.ts',
    ]

    expect(layoutCounts(files, MAP)).toEqual({
      'src/shared/*': 2,
      'src/shared/reply-library': 1,
    })
  })
})

describe('layout: places the map does not name', () => {
  it('reports a folder under an area that is not a declared feature', () => {
    const files = [
      'src/contexts/portal/helpers/format.server.ts',
      'src/contexts/portal/helpers/format.test.ts',
    ]

    expect(layoutCounts(files, MAP)).toEqual({ 'src/contexts/portal/helpers': 1 })
  })

  it('reports an area the map does not declare', () => {
    expect(layoutCounts(['src/contexts/billing/build.ts'], MAP)).toEqual({
      'src/contexts/billing': 1,
    })
  })

  it('reports a module in a feature that is neither a contract, a server file nor a test', () => {
    const files = [
      'src/contexts/portal/links/format-link.ts',
      'src/contexts/portal/links/index.ts',
    ]

    expect(layoutCounts(files, MAP)).toEqual({
      'src/contexts/portal/links/format-link.ts': 1,
      'src/contexts/portal/links/index.ts': 1,
    })
  })

  it('reports a folder other than ui inside a feature', () => {
    const files = [
      'src/contexts/portal/links/domain/link-rules.ts',
      'src/contexts/portal/links/targets/target-store.server.ts',
    ]

    expect(layoutCounts(files, MAP)).toEqual({
      'src/contexts/portal/links/domain': 1,
      'src/contexts/portal/links/targets': 1,
    })
  })

  it('reports a barrel or a server file inside ui', () => {
    const files = [
      'src/contexts/portal/links/ui/index.ts',
      'src/contexts/portal/links/ui/rows/load-links.server.ts',
    ]

    expect(layoutCounts(files, MAP)).toEqual({
      'src/contexts/portal/links/ui/index.ts': 1,
      'src/contexts/portal/links/ui/rows/load-links.server.ts': 1,
    })
  })

  it('reports a file at an area’s root that is not its map, its wiring or a test', () => {
    expect(layoutCounts(['src/contexts/portal/portal-helpers.ts'], MAP)).toEqual({
      'src/contexts/portal/portal-helpers.ts': 1,
    })
  })

  it('reports a new file or folder at the root of src and of src/components', () => {
    const files = [
      'src/utils.ts',
      'src/hooks/use-thing.ts',
      'src/components/widgets/widget.tsx',
      'src/components/features/loose.tsx',
    ]

    expect(layoutCounts(files, MAP)).toEqual({
      'src/utils.ts': 1,
      'src/hooks': 1,
      'src/components/widgets': 1,
      'src/components/features/loose.tsx': 1,
    })
  })
})

describe('layout: this repository', () => {
  const tree = listSourceFiles(ROOT)

  // Rule 33: the gate must be able to fail. Each planted file is one more than
  // the tree holds today, in a place that may only shrink or does not exist.
  it.each([
    [
      'src/contexts/portal/application/use-cases/planted.ts',
      'src/contexts/portal/application',
    ],
    [
      'src/contexts/portal/infrastructure/planted.ts',
      'src/contexts/portal/infrastructure',
    ],
    ['src/components/features/portal/planted.tsx', 'src/components/features/portal'],
    ['src/components/inbox/planted.tsx', 'src/components/inbox'],
    ['src/shared/planted.ts', 'src/shared/*'],
    ['src/contexts/portal/planted/planted.server.ts', 'src/contexts/portal/planted'],
    ['src/contexts/portal/editor/planted.ts', 'src/contexts/portal/editor/planted.ts'],
    ['src/planted/planted.ts', 'src/planted'],
  ])('a file planted at %s raises %s', (planted, key) => {
    const before = layoutCounts(tree)
    const after = layoutCounts([...tree, planted])

    expect(compareWithBaseline(before, after).regressions).toEqual([
      { file: key, baseline: before[key] ?? 0, current: (before[key] ?? 0) + 1 },
    ])
  })

  it('declares no feature folder that does not exist', () => {
    const declared = Object.entries(LAYOUT.areas).flatMap(([area, features]) =>
      features.map((feature) => `src/contexts/${area}/${feature}`),
    )
    const present = declared.filter((folder) =>
      tree.some((file) => file.startsWith(`${folder}/`)),
    )

    expect(present).toEqual(declared)
  })
})

describe('layout: listing the tree', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('lists nested files by repository path and leaves dot files out', () => {
    const root = mkdtempSync(join(tmpdir(), 'layout-tree-'))
    directories.push(root)
    mkdirSync(join(root, 'src/contexts/portal/editor/ui'), { recursive: true })
    writeFileSync(join(root, 'src/contexts/portal/editor/ui/editor.tsx'), '')
    writeFileSync(join(root, 'src/contexts/portal/editor/.DS_Store'), '')
    writeFileSync(join(root, 'src/start.ts'), '')

    expect(listSourceFiles(root).sort()).toEqual([
      'src/contexts/portal/editor/ui/editor.tsx',
      'src/start.ts',
    ])
  })
})

describe('layout: the gate on a checkout', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  /** A checkout holding `files`, with `baseline` committed. */
  function checkout(files: readonly string[], baseline: Record<string, number>) {
    const root = mkdtempSync(join(tmpdir(), 'layout-gate-'))
    directories.push(root)
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), '')
    }
    const baselinePath = join(root, 'layout.baseline.json')
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    return { root, baselinePath }
  }
  const OLD_FOLDER = 'src/contexts/portal/application'

  it('passes while a folder holds no more than its entry', () => {
    const at = checkout([`${OLD_FOLDER}/create-link.ts`], { [OLD_FOLDER]: 1 })

    expect(runLayoutGate([], at)).toBe(0)
  })

  it('fails when a folder that only shrinks gains a file', () => {
    const at = checkout(
      [`${OLD_FOLDER}/create-link.ts`, `${OLD_FOLDER}/delete-link.ts`],
      {
        [OLD_FOLDER]: 1,
      },
    )

    expect(runLayoutGate([], at)).toBe(1)
  })

  it('refuses to rewrite the baseline upwards', () => {
    const at = checkout(
      [`${OLD_FOLDER}/create-link.ts`, `${OLD_FOLDER}/delete-link.ts`],
      {
        [OLD_FOLDER]: 1,
      },
    )

    expect(runLayoutGate(['--write-baseline'], at)).toBe(1)
    expect(JSON.parse(readFileSync(at.baselinePath, 'utf8'))).toEqual({ [OLD_FOLDER]: 1 })
  })

  it('rewrites the baseline when a folder shrank', () => {
    const at = checkout([`${OLD_FOLDER}/create-link.ts`], { [OLD_FOLDER]: 3 })

    expect(runLayoutGate(['--write-baseline'], at)).toBe(0)
    expect(JSON.parse(readFileSync(at.baselinePath, 'utf8'))).toEqual({ [OLD_FOLDER]: 1 })
  })
})

describe('layout: the failure text', () => {
  it('says where new server code and new screens belong', () => {
    const text = explainLayoutRegressions([
      { file: 'src/contexts/portal/application', baseline: 2, current: 3 },
      { file: 'src/components/inbox', baseline: 1, current: 2 },
    ])

    expect(text).toContain('src/contexts/portal/application: 2 → 3')
    expect(text).toContain('<feature>/<name>.server.ts')
    expect(text).toContain('<feature>/ui/')
    expect(text).toContain('docs/rules.md')
  })

  it('says how to declare a new feature folder', () => {
    const text = explainLayoutRegressions([
      { file: 'src/contexts/portal/links', baseline: 0, current: 3 },
    ])

    expect(text).toContain('LAYOUT.areas')
    expect(text).toContain('scripts/ci/check-layout.ts')
  })
})
