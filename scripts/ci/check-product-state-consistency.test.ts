import { describe, expect, it } from 'vitest'
import {
  auditProductStateSources,
  auditQueryKeyFactorySource,
  loadProductStateLedger,
  type ProductStateLedger,
} from './check-product-state-consistency'

const EMPTY_LEDGER: ProductStateLedger = {
  version: 2,
  scope: ['src/components', 'src/routes'],
  queryKeyFactories: [],
  broadInvalidationExceptions: [],
  stateMirrorCandidates: [],
  classificationDefinitions: {
    server_draft: 'Editable local draft initialized from server-owned input.',
    server_snapshot: 'Local server result advanced by mutation responses.',
    synchronized_prop_copy: 'Local copy with an explicit prop synchronization policy.',
    client_persistence: 'Client-owned state initialized from browser persistence.',
    local_runtime: 'Local runtime state that is not a server-state authority.',
  },
  limitations: ['Fixture ledger; semantic completeness is not claimed.'],
}

describe('product-state consistency audit', () => {
  it('keeps every shared query-key factory member in an owned lifecycle policy', () => {
    const source = {
      path: 'src/shared/queries/query-keys.ts',
      content: `
        export const portalKeys = {
          all: ['portals'] as const,
          list: (propertyId: string) => [...portalKeys.all, 'list', propertyId] as const,
        }
      `,
    }
    const ledger: ProductStateLedger = {
      ...EMPTY_LEDGER,
      queryKeyFactories: [
        {
          id: 'portalKeys',
          members: ['all'],
          owner: 'Portal query lifecycle',
          policy: 'The root owns tenant teardown; property lists include propertyId.',
        },
      ],
    }

    expect(auditQueryKeyFactorySource(source, ledger)).toMatchObject({
      queryKeyFactoryMembers: [{ id: 'portalKeys.all' }, { id: 'portalKeys.list' }],
      violations: ['unowned query-key factory member: portalKeys.list'],
    })
  })

  it('rejects stale query-key lifecycle policy members', () => {
    const ledger: ProductStateLedger = {
      ...EMPTY_LEDGER,
      queryKeyFactories: [
        {
          id: 'removedKeys',
          members: ['all'],
          owner: 'Removed query lifecycle',
          policy: 'This row must not survive its factory.',
        },
      ],
    }

    expect(
      auditQueryKeyFactorySource(
        { path: 'src/shared/queries/query-keys.ts', content: '' },
        ledger,
      ).violations,
    ).toEqual(['stale query-key factory policy: removedKeys.all'])
  })

  it('includes production shared-hook roots in the repository inventory', () => {
    expect(loadProductStateLedger(process.cwd()).scope).toEqual(
      expect.arrayContaining(['src/hooks', 'src/shared/hooks']),
    )
  })

  it('rejects literal query keys while accepting factory-owned keys', () => {
    const report = auditProductStateSources(
      [
        {
          path: 'src/components/literal.tsx',
          content: `useQuery({ queryKey: ['portals', portalId], queryFn: load })`,
        },
        {
          path: 'src/routes/factory.tsx',
          content: `queryOptions({ queryKey: portalKeys.detail(portalId), queryFn: load })`,
        },
      ],
      EMPTY_LEDGER,
    )

    expect(report.queryKeySites).toHaveLength(2)
    expect(report.violations).toEqual([
      'src/components/literal.tsx:1: literal queryKey arrays must use a shared hierarchical factory',
    ])
  })

  it('inventories shorthand queryKey options built outside the call', () => {
    const report = auditProductStateSources(
      [
        {
          path: 'src/components/factory-options.ts',
          content: `
            const queryKey = portalKeys.detail(portalId)
            useQuery({ queryKey, queryFn: load })
          `,
        },
      ],
      EMPTY_LEDGER,
    )

    expect(report.queryKeySites).toHaveLength(1)
  })

  it('allows only explicitly owned broad auth-bootstrap invalidation', () => {
    const ledger: ProductStateLedger = {
      ...EMPTY_LEDGER,
      broadInvalidationExceptions: [
        {
          id: 'src/routes/login.tsx:router.invalidate#1',
          owner: 'Authentication bootstrap',
          rationale: 'Refreshes the route auth context after the active org is selected.',
        },
      ],
    }
    const report = auditProductStateSources(
      [
        {
          path: 'src/routes/login.tsx',
          content: `async function completeLogin() { await router.invalidate() }`,
        },
        {
          path: 'src/components/save.tsx',
          content: `async function save() { await router.invalidate() }`,
        },
      ],
      ledger,
    )

    expect(report.broadInvalidationSites.map(({ id }) => id)).toEqual([
      'src/routes/login.tsx:router.invalidate#1',
      'src/components/save.tsx:router.invalidate#1',
    ])
    expect(report.violations).toEqual([
      'src/components/save.tsx:1: broad router.invalidate() has no owned exception',
    ])
  })

  it('requires every prop-seeded state candidate to have an owned classification', () => {
    const report = auditProductStateSources(
      [
        {
          path: 'src/components/editor.tsx',
          content: `
            function Editor({ serverValue }) {
              const [draft] = useState(serverValue)
              const [open] = useState(false)
              return null
            }
          `,
        },
      ],
      EMPTY_LEDGER,
    )

    expect(report.stateMirrorCandidates.map(({ id }) => id)).toEqual([
      'src/components/editor.tsx:useState(draft)',
    ])
    expect(report.violations).toEqual([
      'src/components/editor.tsx:3: state-mirror candidate useState(draft) has no owned classification',
    ])
  })

  it('does not hide server-seeded state inside composite or lazy initializers', () => {
    const report = auditProductStateSources(
      [
        {
          path: 'src/components/composite.tsx',
          content: `
            function Editor({ record }) {
              const [draft] = useState({ text: record.text })
              const [selection] = useState([...record.ids])
              const [lazy] = useState(() => record.value)
            }
          `,
        },
      ],
      EMPTY_LEDGER,
    )

    expect(report.stateMirrorCandidates.map(({ id }) => id)).toEqual([
      'src/components/composite.tsx:useState(draft)',
      'src/components/composite.tsx:useState(selection)',
      'src/components/composite.tsx:useState(lazy)',
    ])
  })

  it('rejects stale ledger rows so exceptions cannot silently outlive their source', () => {
    const ledger: ProductStateLedger = {
      ...EMPTY_LEDGER,
      broadInvalidationExceptions: [
        {
          id: 'src/routes/removed.tsx:router.invalidate#1',
          owner: 'Authentication bootstrap',
          rationale: 'Historical exception that should be removed.',
        },
      ],
      stateMirrorCandidates: [
        {
          id: 'src/components/removed.tsx:useState(snapshot)',
          classification: 'server_draft',
          owner: 'Removed editor',
          policy: 'Historical policy that should be removed.',
        },
      ],
    }

    expect(auditProductStateSources([], ledger).violations).toEqual([
      'stale broad-invalidation exception: src/routes/removed.tsx:router.invalidate#1',
      'stale state-mirror classification: src/components/removed.tsx:useState(snapshot)',
    ])
  })
})
