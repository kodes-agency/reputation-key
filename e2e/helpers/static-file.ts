// Where a request path lands inside a directory being served, and nowhere else.
// Used by `e2e/storybook-metrics/static-server.ts`; kept apart so the rule that
// matters (a path never leaves the root) is unit-tested.

import { statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'

/** The file a request path names inside `root`, or null when it leaves `root` or is no file. */
export function resolveStaticFile(root: string, requestPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/')
  } catch {
    return null
  }
  const target = resolve(join(root, normalize(decoded)))
  if (target !== root && !target.startsWith(root + sep)) return null
  try {
    const found = statSync(target)
    if (found.isFile()) return target
    if (found.isDirectory()) {
      const index = join(target, 'index.html')
      return statSync(index).isFile() ? index : null
    }
  } catch {
    return null
  }
  return null
}
