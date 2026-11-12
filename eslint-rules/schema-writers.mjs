import { relative } from 'node:path'

// A table with one owner is written only from that owner's files. Reads stay
// free; a second writer needs the owner to expose a function instead.
const OWNERS = [
  {
    tables: {
      replies: 'replies',
      replyPublicationAttempts: 'reply_publication_attempts',
      replyPublicationAuthorizations: 'reply_publication_authorizations',
    },
    owner: 'src/contexts/reputation/replies/',
  },
  {
    tables: { auditEvents: 'audit_events' },
    owner: 'src/contexts/feed/audit/',
  },
  {
    tables: { notifications: 'notifications' },
    owner: 'src/contexts/feed/',
  },
]

const WRITE_METHODS = new Set(['insert', 'update', 'delete'])
const symbolOwners = new Map(
  OWNERS.flatMap(({ tables, owner }) =>
    Object.entries(tables).map(([symbol, name]) => [symbol, { name, owner }]),
  ),
)
const sqlOwners = OWNERS.flatMap(({ tables, owner }) =>
  Object.values(tables).map((name) => ({
    owner,
    name,
    pattern: new RegExp(
      `\\b(?:UPDATE|DELETE\\s+FROM|INSERT\\s+INTO)\\s+(?:ONLY\\s+)?"?${name}"?(?![\\w"])`,
      'iu',
    ),
  })),
)

function filename(context) {
  return relative(context.cwd, context.filename).split('\\').join('/')
}

const owner = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      notOwner:
        'Only {{owner}} writes {{table}}. Call the owner instead of writing the table here.',
    },
  },
  create(context) {
    const file = filename(context)
    function report(node, table, ownerPath) {
      if (file.startsWith(ownerPath)) return
      context.report({ node, messageId: 'notOwner', data: { table, owner: ownerPath } })
    }
    return {
      CallExpression(node) {
        const { callee } = node
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          !WRITE_METHODS.has(callee.property.name)
        )
          return
        const target = node.arguments[0]
        const symbol =
          target?.type === 'Identifier'
            ? target.name
            : target?.type === 'MemberExpression' && !target.computed
              ? target.property.name
              : undefined
        const entry = symbol && symbolOwners.get(symbol)
        if (entry) report(node, entry.name, entry.owner)
      },
      TemplateElement(node) {
        for (const { owner: ownerPath, name, pattern } of sqlOwners) {
          if (pattern.test(node.value.raw)) report(node, name, ownerPath)
        }
      },
    }
  },
}

export default { rules: { owner } }
