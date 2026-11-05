// A literal `queryKey` or `invalidateKeys` array sits outside the key factories
// in src/shared/queries/query-keys.ts, so no factory invalidation can reach it.
// Whole-router invalidation re-runs every loader; only sign-in (its auth context
// must be rebuilt) and a failed route's retry (it cannot name the failed
// matches) may do it, once each.
import { relative } from 'node:path'

const propertyName = (node) => node?.name ?? node?.value
const unwrap = (node) => {
  while (
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'TSTypeAssertion',
    ].includes(node?.type)
  )
    node = node.expression
  return node
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      literal:
        'Use a shared hierarchical query-key factory instead of a literal key array.',
      invalidations: 'invalidateKeys must be a non-empty array of shared factory keys.',
      broad:
        'Invalidate specific route matches; whole-router invalidation is reserved for sign-in and route-error retry.',
    },
  },
  create(context) {
    const filename = relative(context.cwd, context.filename).replaceAll('\\', '/')
    // Sign-in rebuilds auth context; a failed route cannot name its failed matches.
    const allowsBroad =
      filename === 'src/routes/login.tsx' ||
      filename === 'src/components/layout/use-guarded-route-error.tsx'
    let broadCalls = 0

    const resolve = (expression, visited = new Set()) => {
      const node = unwrap(expression)
      if (node?.type !== 'Identifier' || visited.has(node.name)) return node
      visited.add(node.name)
      let scope = context.sourceCode.getScope(node)
      while (scope) {
        const variable = scope.set.get(node.name)
        if (variable) {
          const initializer = variable.defs.length === 1 && variable.defs[0].node.init
          return initializer ? resolve(initializer, visited) : node
        }
        scope = scope.upper
      }
      return node
    }

    const hasFactoryPrefix = (array) => {
      const first = array.elements[0]
      if (first?.type !== 'SpreadElement') return false
      const prefix = resolve(first.argument)
      const member = prefix?.type === 'CallExpression' ? prefix.callee : prefix
      if (member?.type !== 'MemberExpression' || member.object.type !== 'Identifier')
        return false
      let scope = context.sourceCode.getScope(member.object)
      while (scope) {
        const variable = scope.set.get(member.object.name)
        if (variable) {
          return variable.defs.some(
            (definition) =>
              definition.type === 'ImportBinding' &&
              /(?:^|\/)query-keys(?:\.ts)?$/.test(definition.parent.source.value),
          )
        }
        scope = scope.upper
      }
      return false
    }

    const containsLiteralKey = (array, visited = new Set()) => {
      if (visited.has(array)) return false
      visited.add(array)
      return array.elements.some((element) => {
        if (element?.type === 'SpreadElement') {
          const spread = resolve(element.argument)
          return spread?.type === 'ArrayExpression' && containsLiteralKey(spread, visited)
        }
        const key = resolve(element)
        return key?.type === 'ArrayExpression' && !hasFactoryPrefix(key)
      })
    }

    return {
      Property(node) {
        if (node.parent.type !== 'ObjectExpression') return
        const name = propertyName(node.key)
        if (name !== 'queryKey' && name !== 'invalidateKeys') return
        const value = resolve(node.value)
        if (name === 'queryKey') {
          if (value?.type === 'ArrayExpression' && !hasFactoryPrefix(value)) {
            context.report({ node, messageId: 'literal' })
          }
          return
        }
        if (value?.type !== 'ArrayExpression' || value.elements.length === 0) {
          context.report({ node, messageId: 'invalidations' })
          return
        }
        if (containsLiteralKey(value)) {
          context.report({ node, messageId: 'literal' })
        }
      },
      CallExpression(node) {
        if (
          node.arguments.length === 0 &&
          node.callee.type === 'MemberExpression' &&
          propertyName(node.callee.property) === 'invalidate'
        ) {
          broadCalls += 1
          if (!allowsBroad || broadCalls > 1) {
            context.report({ node, messageId: 'broad' })
          }
        }
      },
    }
  },
}
