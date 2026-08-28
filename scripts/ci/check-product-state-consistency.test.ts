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
  queryKeyDelegates: [],
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

  it('requires every query-key member to descend from its own family root', () => {
    const source = {
      path: 'src/shared/queries/query-keys.ts',
      content: `
        export const portalKeys = {
          all: ['portals'] as const,
          list: (propertyId: string) => ['list', propertyId] as const,
          detail: (portalId: string) => [...identityKeys.all, 'detail', portalId] as const,
        }
        export const identityKeys = {
          all: ['identity'] as const,
        }
      `,
    }
    const ledger: ProductStateLedger = {
      ...EMPTY_LEDGER,
      queryKeyFactories: [
        {
          id: 'portalKeys',
          members: ['all', 'list', 'detail'],
          owner: 'Portal query lifecycle',
          policy: 'Every Portal key descends from the Portal root.',
        },
        {
          id: 'identityKeys',
          members: ['all'],
          owner: 'Identity query lifecycle',
          policy: 'Every Identity key descends from the Identity root.',
        },
      ],
    }

    expect(auditQueryKeyFactorySource(source, ledger).violations).toEqual([
      'query-key factory member must begin with its own family prefix: portalKeys.list',
      'query-key factory member must begin with its own family prefix: portalKeys.detail',
    ])
  })

  it('rejects duplicate roots and hierarchy cycles', () => {
    const source = {
      path: 'src/shared/queries/query-keys.ts',
      content: `
        export const portalKeys = {
          all: ['shared'] as const,
          list: () => [...portalKeys.detail(), 'list'] as const,
          detail: () => [...portalKeys.list(), 'detail'] as const,
        }
        export const identityKeys = {
          all: ['shared'] as const,
        }
      `,
    }
    const ledger: ProductStateLedger = {
      ...EMPTY_LEDGER,
      queryKeyFactories: [
        {
          id: 'portalKeys',
          members: ['all', 'list', 'detail'],
          owner: 'Portal query lifecycle',
          policy: 'Every Portal key descends from one unique root.',
        },
        {
          id: 'identityKeys',
          members: ['all'],
          owner: 'Identity query lifecycle',
          policy: 'Every Identity key descends from one unique root.',
        },
      ],
    }

    expect(auditQueryKeyFactorySource(source, ledger).violations).toEqual([
      'query-key factory hierarchy is cyclic: portalKeys.list',
      'query-key factory hierarchy is cyclic: portalKeys.detail',
      'query-key factory root collision: portalKeys.all and identityKeys.all both use "shared"',
    ])
  })

  it('includes production shared-hook roots in the repository inventory', () => {
    expect(loadProductStateLedger(process.cwd()).scope).toEqual(
      expect.arrayContaining(['src/hooks', 'src/shared/hooks']),
    )
  })

  it('rejects literal query keys while accepting factory-owned keys', () => {
    const ledger: ProductStateLedger = {
      ...EMPTY_LEDGER,
      queryKeyFactories: [
        {
          id: 'portalKeys',
          members: ['detail'],
          owner: 'Portal query lifecycle',
          policy: 'Portal detail identity includes the Portal id.',
        },
      ],
    }
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
      ledger,
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

  it('requires generic query-key delegates to be explicit and owned', () => {
    const source = {
      path: 'src/components/query-helper.ts',
      content: `
        function options(queryKey) {
          return { queryKey, queryFn: load }
        }
      `,
    }
    const denied = auditProductStateSources([source], EMPTY_LEDGER)
    expect(denied.violations).toEqual([
      'src/components/query-helper.ts:3: queryKey is neither factory-owned nor an explicit generic delegate',
    ])

    const allowed = auditProductStateSources([source], {
      ...EMPTY_LEDGER,
      queryKeyDelegates: [
        {
          id: 'src/components/query-helper.ts:queryKey#1',
          owner: 'Feature query adapter',
          policy: 'The sole caller supplies one exact factory-owned key.',
        },
      ],
    })
    expect(allowed.violations).toEqual([])
  })

  it('rejects stale or undocumented query-key delegate exceptions', () => {
    const ledger: ProductStateLedger = {
      ...EMPTY_LEDGER,
      queryKeyDelegates: [
        {
          id: 'src/components/removed.ts:queryKey#1',
          owner: '',
          policy: '',
        },
      ],
    }

    expect(auditProductStateSources([], ledger).violations).toEqual([
      'query-key delegate lacks ownership detail: src/components/removed.ts:queryKey#1',
      'stale query-key delegate: src/components/removed.ts:queryKey#1',
    ])
  })

  it('requires targeted mutation invalidations to use owned factory keys', () => {
    const ledger: ProductStateLedger = {
      ...EMPTY_LEDGER,
      queryKeyFactories: [
        {
          id: 'portalKeys',
          members: ['detail'],
          owner: 'Portal query lifecycle',
          policy: 'Portal detail identity includes the Portal id.',
        },
      ],
    }
    const report = auditProductStateSources(
      [
        {
          path: 'src/routes/mutations.tsx',
          content: `
            const detailInvalidations = [portalKeys.detail(portalId)]
            useActionMutation(save, { invalidateKeys: detailInvalidations })
            useActionMutation(remove, { invalidateKeys: [portalKeys.detail(portalId)] })
            useActionMutation(unsafe, { invalidateKeys: [['portals', portalId]] })
          `,
        },
      ],
      ledger,
    )

    expect(report.mutationInvalidationSites).toHaveLength(3)
    expect(report.violations).toEqual([
      'src/routes/mutations.tsx:5: invalidateKeys contains a key without an owned shared factory',
    ])
  })

  it('rejects empty or dynamically opaque mutation invalidation arrays', () => {
    const report = auditProductStateSources(
      [
        {
          path: 'src/routes/mutations.tsx',
          content: `
            useActionMutation(save, { invalidateKeys: [] })
            useActionMutation(remove, { invalidateKeys: buildKeys() })
          `,
        },
      ],
      EMPTY_LEDGER,
    )

    expect(report.violations).toEqual([
      'src/routes/mutations.tsx:2: invalidateKeys must be a non-empty statically resolvable array',
      'src/routes/mutations.tsx:3: invalidateKeys must be a non-empty statically resolvable array',
    ])
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

  it('rejects effect-based overwrites of an in-progress server draft', () => {
    const source = {
      path: 'src/components/editor.tsx',
      content: `
        function Editor({ serverValue }) {
          const [draft, setDraft] = useState(serverValue)
          useEffect(() => setDraft(serverValue), [serverValue])
          return draft
        }
      `,
    }
    const id = 'src/components/editor.tsx:useState(draft)'
    const report = auditProductStateSources([source], {
      ...EMPTY_LEDGER,
      stateMirrorCandidates: [
        {
          id,
          classification: 'server_draft',
          owner: 'Example editor',
          policy: 'User edits remain local until an explicit remount.',
        },
      ],
    })

    expect(report.violations).toEqual([
      'src/components/editor.tsx:3: server draft useState(draft) is overwritten from an effect; use an explicit remount/conflict boundary',
    ])
  })

  it('permits an owned synchronized prop copy to reconcile in an effect', () => {
    const source = {
      path: 'src/components/debounced.tsx',
      content: `
        function Debounced({ value }) {
          const [debounced, setDebounced] = useState(value)
          useEffect(() => setDebounced(value), [value])
          return debounced
        }
      `,
    }
    const report = auditProductStateSources([source], {
      ...EMPTY_LEDGER,
      stateMirrorCandidates: [
        {
          id: 'src/components/debounced.tsx:useState(debounced)',
          classification: 'synchronized_prop_copy',
          owner: 'Debounce helper',
          policy: 'The delayed prop copy is the declared behavior.',
        },
      ],
    })

    expect(report.violations).toEqual([])
  })

  it('rejects duplicate or ownerless state classifications', () => {
    const source = {
      path: 'src/components/editor.tsx',
      content: `const [draft] = useState(serverValue)`,
    }
    const id = 'src/components/editor.tsx:useState(draft)'
    const row = {
      id,
      classification: 'server_draft' as const,
      owner: '',
      policy: '',
    }
    const report = auditProductStateSources([source], {
      ...EMPTY_LEDGER,
      stateMirrorCandidates: [row, row],
    })

    expect(report.violations).toEqual([
      `state-mirror classification lacks ownership detail: ${id}`,
      `state-mirror classification lacks ownership detail: ${id}`,
      `duplicate state-mirror classification: ${id}`,
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
