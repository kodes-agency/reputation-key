const DEPRECATED_FORMATS = new Set([
  'base64',
  'cidr',
  'cuid',
  'cuid2',
  'date',
  'datetime',
  'duration',
  'email',
  'emoji',
  'ip',
  'jwt',
  'nanoid',
  'time',
  'ulid',
  'url',
  'uuid',
])
const PINNED = 'zod/v4'

const stringValue = (node) =>
  node?.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined
const isZod = (value) => value === 'zod' || value.startsWith('zod/')
const memberName = (node) => {
  if (node?.type !== 'MemberExpression') return undefined
  return !node.computed && node.property.type === 'Identifier'
    ? node.property.name
    : stringValue(node.property)
}

export default {
  meta: {
    type: 'problem',
    messages: {
      pinned: "Import the pinned API explicitly from 'zod/v4'.",
      format: 'Use z.{{format}}() instead of z.string().{{format}}().',
      datetime: 'Use z.iso.datetime() instead of z.string().datetime().',
    },
    schema: [],
  },
  create(context) {
    const checkSource = (node) => {
      const value = stringValue(node)
      if (value && isZod(value) && value !== PINNED) {
        context.report({ node, messageId: 'pinned' })
      }
    }
    const isPinnedBinding = (identifier) => {
      let scope = context.sourceCode.getScope(identifier)
      while (scope) {
        const variable = scope.set.get(identifier.name)
        if (variable) {
          return variable.defs.some((definition) => {
            const specifier = definition.node
            const importsZ =
              specifier.type !== 'ImportSpecifier' ||
              (specifier.imported.name ?? specifier.imported.value) === 'z'
            return (
              definition.type === 'ImportBinding' &&
              stringValue(definition.parent?.source) === PINNED &&
              importsZ
            )
          })
        }
        scope = scope.upper
      }
      return false
    }

    return {
      ImportDeclaration: (node) => checkSource(node.source),
      ExportNamedDeclaration: (node) => node.source && checkSource(node.source),
      ExportAllDeclaration: (node) => checkSource(node.source),
      ImportExpression: (node) => checkSource(node.source),
      TSImportEqualsDeclaration: (node) => checkSource(node.moduleReference?.expression),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          if (node.arguments.length === 1) checkSource(node.arguments[0])
        }

        const format = memberName(node.callee)
        const stringCall = node.callee.type === 'MemberExpression' && node.callee.object
        const stringMember =
          stringCall?.type === 'CallExpression' &&
          stringCall.callee.type === 'MemberExpression' &&
          stringCall.callee
        if (
          !format ||
          !DEPRECATED_FORMATS.has(format) ||
          memberName(stringMember) !== 'string' ||
          stringMember.object.type !== 'Identifier' ||
          !isPinnedBinding(stringMember.object)
        ) {
          return
        }
        context.report({
          node,
          messageId: format === 'datetime' ? 'datetime' : 'format',
          data: { format },
        })
      },
    }
  },
}
