import { basename, relative, resolve } from 'node:path'

const MUTATION_HOOKS = new Set([
  'src/components/inbox/use-reply-actions.ts',
  'src/contexts/portal/editor/ui/link-tree/use-linktree-mutations.ts',
])

function filename(context) {
  return relative(context.cwd, context.filename).split('\\').join('/')
}

function importedPath(context, source) {
  if (typeof source !== 'string') return ''
  if (source.startsWith('#/')) return `src/${source.slice(2)}`
  if (source.startsWith('.')) {
    return relative(context.cwd, resolve(context.filename, '..', source))
      .split('\\')
      .join('/')
  }
  return source
}

function typeOnly(node) {
  return (
    node.importKind === 'type' ||
    node.exportKind === 'type' ||
    (node.specifiers?.length > 0 &&
      node.specifiers.every(
        (specifier) => specifier.importKind === 'type' || specifier.exportKind === 'type',
      ))
  )
}

// Visit every runtime edge, including re-exports through a barrel. Type-only
// contracts do not execute a server module and remain safe to share.
function importRule(messageId, message, forbidden) {
  return {
    meta: { type: 'problem', schema: [], messages: { [messageId]: message } },
    create(context) {
      function check(node, source) {
        if (
          !typeOnly(node) &&
          forbidden(filename(context), importedPath(context, source), node)
        ) {
          context.report({ node, messageId })
        }
      }
      return {
        ImportDeclaration: (node) => check(node, node.source.value),
        ExportNamedDeclaration: (node) => check(node, node.source?.value),
        ExportAllDeclaration: (node) => check(node, node.source.value),
        ImportExpression: (node) => check(node, node.source.value),
        CallExpression(node) {
          if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
            check(node, node.arguments[0]?.value)
          }
        },
      }
    },
  }
}

const componentServer = importRule(
  'serverImport',
  'Receive server functions from the route; only the documented mutation hooks import them directly.',
  (file, target) =>
    !MUTATION_HOOKS.has(file) && /^src\/contexts\/[^/]+\/server(?:\/|$)/u.test(target),
)
const browserServer = importRule(
  'serverOnly',
  'Browser sources must not value-import a *.server module. Use a browser contract or a stationary server function.',
  (file, target, node) => {
    // Vite explicitly keeps this RPC-only browser configuration entry. Its
    // handler is compiled away; this exception grants no plain helper export.
    if (
      file === 'src/routes/__root.tsx' &&
      target === 'src/shared/observability/browser-observability.server' &&
      node.type === 'ImportDeclaration' &&
      node.specifiers.length > 0 &&
      node.specifiers.every(
        (specifier) =>
          specifier.type === 'ImportSpecifier' &&
          specifier.imported.name === 'getBrowserObservabilityConfigFn',
      )
    )
      return false
    return /\.server(?:\.[cm]?[jt]sx?)?$/u.test(target)
  },
)
const systemScope = importRule(
  'workerOnly',
  'System database scope is restricted to worker and operator entry points.',
  (file, target) =>
    /^src\/shared\/db\/system-scope\.server(?:\.[cm]?[jt]s)?$/u.test(target) &&
    !/^(?:src\/worker\/|src\/shared\/jobs\/|scripts\/ops\/)/u.test(file),
)
const componentFilename = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { filename: 'Component files must use kebab-case naming.' },
  },
  create(context) {
    return {
      Program(node) {
        const file = filename(context)
        const name = basename(file)
        if (
          name === 'index.ts' ||
          /^[a-z][a-z0-9-]*\.(?:ts|tsx)$/u.test(name) ||
          (file.split('/').includes('hooks') &&
            /^use-[a-z][a-zA-Z0-9-]*\.ts$/u.test(name)) ||
          /^[a-z][a-z0-9-]*\.(?:test|stories)(?:\.[a-z][a-z0-9-]*)?\.(?:ts|tsx)$/u.test(
            name,
          )
        )
          return
        context.report({ node, messageId: 'filename' })
      },
    }
  },
}

export default {
  rules: {
    'component-filename': componentFilename,
    'component-server': componentServer,
    'browser-server': browserServer,
    'system-scope': systemScope,
  },
}
