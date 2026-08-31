import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROUTE_PATH = 'src/routes/_authenticated/properties/$propertyId/portals/index.tsx'

const EXPECTED_MUTATION_POLICIES = new Map([
  ['createPortalGroup', 'onGroupCreated'],
  ['updatePortalGroup', 'onGroupUpdated'],
  ['softDeletePortalGroup', 'onGroupDeleted'],
  ['addPortalToGroup', 'onGroupMemberAdded'],
  ['removePortalFromGroup', 'onGroupMemberRemoved'],
])

type MutationWiring = Readonly<{
  onSuccess: string | null
  hasGenericInvalidation: boolean
}>

function portalGroupMutationWiring(): Map<string, MutationWiring> {
  const sourceText = readFileSync(resolve(ROUTE_PATH), 'utf8')
  const source = ts.createSourceFile(
    ROUTE_PATH,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const wiring = new Map<string, MutationWiring>()

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useActionMutation' &&
      ts.isIdentifier(node.arguments[0]) &&
      EXPECTED_MUTATION_POLICIES.has(node.arguments[0].text) &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      const options = node.arguments[1]
      const onSuccess = options.properties.find(
        (property) => property.name?.getText(source) === 'onSuccess',
      )
      wiring.set(node.arguments[0].text, {
        onSuccess: onSuccess?.getText(source) ?? null,
        hasGenericInvalidation: options.properties.some(
          (property) => property.name?.getText(source) === 'invalidateKeys',
        ),
      })
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return wiring
}

describe('Portal Group to Goal cache ownership', () => {
  it('routes every Portal Group mutation through its semantic cache policy', () => {
    const wiring = portalGroupMutationWiring()

    expect([...wiring.keys()].sort()).toEqual(
      [...EXPECTED_MUTATION_POLICIES.keys()].sort(),
    )
    for (const [mutation, policyMethod] of EXPECTED_MUTATION_POLICIES) {
      expect(wiring.get(mutation), mutation).toMatchObject({
        onSuccess: expect.stringContaining(
          `portalGroupCachePolicy.${policyMethod}(queryClient, propertyId)`,
        ),
        hasGenericInvalidation: false,
      })
    }
  })
})
