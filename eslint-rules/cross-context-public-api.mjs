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

import path from 'node:path'

const IMPORTER_RE = /\/src\/contexts\/([^/]+)\//
const ADAPTERS_RE = /\/src\/contexts\/[^/]+\/infrastructure\/adapters\//
const TARGET_RE = /^src\/contexts\/([^/]+)\//
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

    function check(node, source) {
      const resolved = resolveSpecifier(source)
      if (resolved === null) return
      const targetMatch = TARGET_RE.exec(resolved)
      if (!targetMatch) return
      const targetContext = targetMatch[1]
      if (targetContext === importerContext) return
      const stripped = stripExtension(resolved)
      if (stripped === `src/contexts/${targetContext}/application/public-api`) return
      if (
        isAdapterImporter &&
        stripped.startsWith(`src/contexts/${targetContext}/application/ports/`)
      ) {
        return
      }
      context.report({ node, messageId: 'publicApiOnly', data: { source } })
    }

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value === 'string') check(node.source, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source && typeof node.source.value === 'string') {
          check(node.source, node.source.value)
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
    }
  },
}
