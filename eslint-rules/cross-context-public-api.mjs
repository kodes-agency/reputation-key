// BQC-5.1: local eslint rule enforcing src/contexts/CONTEXT.md "Dependency rules":
//
//   "Cross-context: import from application/public-api.ts only. Never from
//    domain/, infrastructure/, server/, or non-public-api application/."
//   "Exception: Cross-context adapter implementations (infrastructure/adapters/**)
//    may import the port they implement (application/ports/**). The port IS the
//    public interface for adapter contracts."
//
// eslint-plugin-boundaries enforces layer-to-layer rules via element types but
// has no notion of WHICH context a file belongs to, so it cannot express
// "foreign context ⇒ public-api only". This rule does the path math directly:
// no resolver, no external deps — bare package specifiers are out of scope.
//
// Browser exception: a feature's ui/ screens and contracts.ts are the browser
// surface of their context. From such a file another context's server/
// modules may be imported when only types are taken (the signatures of server
// functions the route binds). Values stay public-api only.

import path from 'node:path'

const IMPORTER_RE = /\/src\/contexts\/([^/]+)\//
const ADAPTERS_RE = /\/src\/contexts\/[^/]+\/infrastructure\/adapters\//
const TARGET_RE = /^src\/contexts\/([^/]+)\//
// Review, Inbox and Reputation are one bounded context.
const MERGED_CONTEXTS = new Set(['reputation', 'review', 'inbox'])

const LAYER_FOLDERS = 'domain|application|infrastructure|server|ports|queries|ui'
const BROWSER_IMPORTER_RE = new RegExp(
  `/src/contexts/[^/]+/(?!(?:${LAYER_FOLDERS})/)[^/]+/(?:ui/|contracts\\.ts$)`,
)
const TYPE_ONLY_TARGET_RE = /^src\/contexts\/[^/]+\/server\//

const EXTENSION_RE = /\.(d\.ts|tsx?|jsx?|m[ct]s)$/

const stripExtension = (p) => p.replace(EXTENSION_RE, '')

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce the CONTEXT.md cross-context rule: a foreign context may only be imported through its application/public-api (adapter port exception).',
    },
    messages: {
      publicApiOnly:
        "Cross-context import '{{source}}' violates src/contexts/CONTEXT.md \"Dependency rules\": import from the target context's application/public-api.ts only — never domain/, infrastructure/, server/, or non-public-api application/. Exception: infrastructure/adapters/** may import the foreign application/ports/** contract they implement.",
    },
    schema: [],
  },
  create(context) {
    const filename = (context.filename ?? '').replace(/\\/g, '/')
    const importerMatch = IMPORTER_RE.exec(filename)
    if (!importerMatch) return {}
    const importerContext = importerMatch[1]
    const isAdapterImporter = ADAPTERS_RE.test(filename)
    const isBrowserImporter = BROWSER_IMPORTER_RE.test(filename)
    const cwd = context.cwd

    // Resolve a specifier to a cwd-relative path ('#/x' → 'src/x'; relative
    // specifiers resolve against the importer dir). Returns null for bare
    // package specifiers, which this rule does not govern.
    function resolveSpecifier(source) {
      if (source.startsWith('#/')) return `src/${source.slice(2)}`
      if (source.startsWith('./') || source.startsWith('../')) {
        const abs = path.resolve(path.dirname(filename), source)
        return path.relative(cwd, abs).split(path.sep).join('/')
      }
      return null
    }

    function check(node, source, isTypeOnly = false) {
      const resolved = resolveSpecifier(source)
      if (resolved === null) return
      const targetMatch = TARGET_RE.exec(resolved)
      if (!targetMatch) return
      const targetContext = targetMatch[1]
      if (targetContext === importerContext) return
      if (
        MERGED_CONTEXTS.has(targetContext) &&
        MERGED_CONTEXTS.has(importerContext) &&
        (targetContext === 'reputation' || importerContext === 'reputation')
      ) {
        return
      }
      const stripped = stripExtension(resolved)
      if (stripped === `src/contexts/${targetContext}/application/public-api`) return
      if (
        isAdapterImporter &&
        stripped.startsWith(`src/contexts/${targetContext}/application/ports/`)
      ) {
        return
      }
      if (isBrowserImporter && isTypeOnly && TYPE_ONLY_TARGET_RE.test(stripped)) return
      context.report({ node, messageId: 'publicApiOnly', data: { source } })
    }

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== 'string') return
        const isTypeOnly =
          node.importKind === 'type' ||
          (node.specifiers.length > 0 &&
            node.specifiers.every(
              (s) => s.type === 'ImportSpecifier' && s.importKind === 'type',
            ))
        check(node.source, node.source.value, isTypeOnly)
      },
      ExportNamedDeclaration(node) {
        if (node.source && typeof node.source.value === 'string') {
          check(node.source, node.source.value, node.exportKind === 'type')
        }
      },
      ExportAllDeclaration(node) {
        if (typeof node.source.value === 'string') check(node.source, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          check(node.source, node.source.value)
        }
      },
      // Inline type-position imports: `import('…').T` and `typeof import('…')`.
      // typescript-estree 8 carries the specifier on `source`.
      TSImportType(node) {
        if (node.source?.type === 'Literal' && typeof node.source.value === 'string') {
          check(node.source, node.source.value, true)
        }
      },
    }
  },
}
