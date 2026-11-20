import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SERVER = join(process.cwd(), 'src/contexts/guest/server')

// A guest's request acts for the guest alone. A signed-in member's tenant and
// permission checks belong to the manager endpoints, never to these modules.
describe('guest public server functions', () => {
  it.each(['public.ts', 'guest-scans.ts', 'guest-public-binding.server.ts'])(
    'does not resolve a tenant or a member permission in %s',
    (file) => {
      const source = readFileSync(join(SERVER, file), 'utf8')

      expect(source).not.toContain('resolveTenantContext')
      expect(source).not.toContain('requireExecutionAllowed')
    },
  )
})
