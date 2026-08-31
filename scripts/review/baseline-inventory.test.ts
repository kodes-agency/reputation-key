import { describe, expect, it } from 'vitest'
import {
  classifyArtifact,
  discoverEntryPoints,
  expandFindingExpression,
  extractFunctionLikeSymbols,
  extractImports,
  parseFindingRegister,
  parseTraceabilityMap,
} from './baseline-inventory'

describe('baseline inventory', () => {
  it('extracts static and dynamic imports without treating comments as dependencies', () => {
    const source = `
      import value from './static'
      export { other } from './re-export'
      // import './comment-only'
      const lazy = import('./dynamic')
      const required = require('./required')
    `

    expect(extractImports('fixture.ts', source)).toEqual([
      './dynamic',
      './re-export',
      './required',
      './static',
    ])
  })

  it('inventories named functions, function variables, and class methods with stable locations', () => {
    const source = `
      export function declared() { return 1 }
      const arrow = () => 2
      const expression = function namedExpression() { return 3 }
      class Example { method() { return 4 } }
    `

    expect(extractFunctionLikeSymbols('fixture.ts', source)).toEqual([
      expect.objectContaining({ kind: 'function', name: 'declared', line: 2 }),
      expect.objectContaining({ kind: 'function-variable', name: 'arrow', line: 3 }),
      expect.objectContaining({ kind: 'function-variable', name: 'expression', line: 4 }),
      expect.objectContaining({ kind: 'method', name: 'Example.method', line: 5 }),
    ])
  })

  it('classifies production, test, support, and generated artifacts explicitly', () => {
    expect(classifyArtifact('src/contexts/inbox/domain/item.ts')).toBe('production')
    expect(classifyArtifact('src/contexts/inbox/domain/item.test.ts')).toBe('test')
    expect(classifyArtifact('scripts/ops/rebuild.ts')).toBe('support')
    expect(classifyArtifact('src/routeTree.gen.ts')).toBe('generated')
  })

  it('discovers multiple entry-point kinds in the same module', () => {
    const source = `
      export const Route = createAPIFileRoute('/api/example')({})
      export const action = createServerFn({ method: 'POST' })
      worker.on('completed', handler)
    `

    expect(discoverEntryPoints('src/routes/api/example.ts', source)).toEqual([
      expect.objectContaining({ kind: 'api-route' }),
      expect.objectContaining({ kind: 'event-consumer' }),
      expect.objectContaining({ kind: 'route' }),
      expect.objectContaining({ kind: 'server-function' }),
    ])
  })

  it('expands slash and inclusive range finding expressions', () => {
    expect(expandFindingExpression('SEC-03/04')).toEqual(['SEC-03', 'SEC-04'])
    expect(expandFindingExpression('UI-08/17/18')).toEqual(['UI-08', 'UI-17', 'UI-18'])
    expect(expandFindingExpression('DATA-08..10')).toEqual([
      'DATA-08',
      'DATA-09',
      'DATA-10',
    ])
  })

  it('joins review findings to the implementation package traceability table', () => {
    const report = `
      | SEC-01 | High | Unsafe upload finalization | C/I |
      | GATE-01 | **Gate blocker** | new | Two tests fail | R |
      | AUTH-01 | **High** | P1-16/P1-17 | Sessions survive recovery | C |
    `
    const plan = `
      | \`SEC-01\` | \`SAFE-01\`, \`POR-01\` | Portal blocker |
      | \`GATE-01\` | \`FND-01/04\`, \`SAFE-05\` | Gate A/B blocker |
      | \`SEC-05..09\`, \`AUTH-01\` | \`SAFE-02\` | Identity blocker |
    `

    expect(parseTraceabilityMap(plan)).toEqual(
      new Map([
        ['AUTH-01', ['SAFE-02']],
        ['GATE-01', ['FND-01', 'FND-04', 'SAFE-05']],
        ['SEC-05', ['SAFE-02']],
        ['SEC-06', ['SAFE-02']],
        ['SEC-07', ['SAFE-02']],
        ['SEC-08', ['SAFE-02']],
        ['SEC-09', ['SAFE-02']],
        ['SEC-01', ['POR-01', 'SAFE-01']],
      ]),
    )
    expect(parseFindingRegister(report, parseTraceabilityMap(plan))).toEqual([
      expect.objectContaining({
        id: 'AUTH-01',
        disposition: 'confirmed',
        severity: 'High',
        summary: 'Sessions survive recovery',
        targetPackages: ['SAFE-02'],
      }),
      expect.objectContaining({
        id: 'GATE-01',
        disposition: 'reproduced',
        summary: 'Two tests fail',
        targetPackages: ['FND-01', 'FND-04', 'SAFE-05'],
      }),
      expect.objectContaining({
        id: 'SEC-01',
        disposition: 'confirmed',
        targetPackages: ['POR-01', 'SAFE-01'],
      }),
    ])
  })
})
