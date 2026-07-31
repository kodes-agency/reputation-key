// BQC-7.6 — security-header wiring gate (STD-P1-07 closure).
//
// STD-P1-07: the original server/plugins/security-headers.ts was written
// against the nitropack v2 API (`defineNitroPlugin` from 'nitropack/server',
// the 'beforeResponse' hook, `event.node.res`) while the project builds with
// nitro v3 (`nitro/vite`) — and nitro's serverDir scanning stays off under
// TanStack Start, so the explicit `plugins` array in vite.config.ts is the
// ONLY registration path. The plugin was dead code: production responses
// carried no B0.7 headers at all.
//
// This gate pins the repaired wiring so it cannot silently regress:
//   (a) vite.config.ts registers server/plugins/security-headers.ts in the
//       nitro `plugins` array (string wiring is invisible to static import
//       analysis — this scan is the guard).
//   (b) the plugin file never imports from 'nitropack*' (the v2 API that made
//       it inert) and delegates to the v3-compatible plugin in
//       src/shared/security/security-headers.ts.
//   (c) the shared plugin module hooks the nitro v3 `response` lifecycle
//       (res: Response) — not the dead v2 'beforeResponse' hook.
// The booted-artifact proof lives in scripts/check-security-headers.mjs (CI).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string): string => readFileSync(path, 'utf-8')

describe('architecture: security-header wiring (BQC-7.6 / STD-P1-07)', () => {
  it('(a) vite.config.ts nitro plugins array registers the security-headers plugin', () => {
    const viteConfig = read('vite.config.ts')
    // Anchor on the nitro({ ... }) call — the top-level vite `plugins` array
    // is a different list. The nitro plugins array holds only quoted paths.
    const pluginsBlock = /nitro\(\{[\s\S]*?plugins:\s*\[([\s\S]*?)\]/.exec(viteConfig)
    expect(
      pluginsBlock,
      'vite.config.ts must pass an explicit plugins array to nitro()',
    ).not.toBeNull()
    expect(pluginsBlock![1]).toContain('server/plugins/security-headers.ts')
  })

  it('(b) server/plugins/security-headers.ts never imports the nitropack v2 API', () => {
    const plugin = read('server/plugins/security-headers.ts')
    const imports = plugin.match(/from\s+'[^']+'/g) ?? []
    const nitropackImports = imports.filter((i) => i.includes('nitropack'))
    expect(
      nitropackImports,
      'nitropack v2 API is not installed for nitro v3 — importing it made the plugin inert (STD-P1-07)',
    ).toEqual([])
    // Thin-wiring rule: logic stays in src/shared/security (unit-tested);
    // the plugin file only delegates.
    expect(plugin).toContain('#/shared/security/security-headers')
  })

  it('(c) the shared plugin hooks the nitro v3 `response` lifecycle, not v2 `beforeResponse`', () => {
    const shared = read('src/shared/security/security-headers.ts')
    expect(shared).toContain("hook('response'")
    expect(shared).not.toContain('beforeResponse')
  })

  it('(d) the request-guard plugin is wired the same way (BQC-7.6)', () => {
    const viteConfig = read('vite.config.ts')
    const pluginsBlock = /nitro\(\{[\s\S]*?plugins:\s*\[([\s\S]*?)\]/.exec(viteConfig)
    expect(pluginsBlock![1]).toContain('server/plugins/request-guard.ts')

    const plugin = read('server/plugins/request-guard.ts')
    const imports = plugin.match(/from\s+'[^']+'/g) ?? []
    expect(imports.filter((i) => i.includes('nitropack'))).toEqual([])
    expect(plugin).toContain('#/shared/security/request-guard')
  })

  it('(e) the production placeholder-secret guard boots first (BQC-7.6)', () => {
    const viteConfig = read('vite.config.ts')
    const pluginsBlock = /nitro\(\{[\s\S]*?plugins:\s*\[([\s\S]*?)\]/.exec(viteConfig)
    // First entry: the guard must run before any other plugin wires behavior.
    expect(pluginsBlock![1]).toMatch(/^\s*'server\/plugins\/production-secret-guard\.ts'/)

    const plugin = read('server/plugins/production-secret-guard.ts')
    expect(plugin).toContain('#/shared/config/production-secrets')

    // The worker process (no nitro) runs the same assertion at boot.
    const worker = read('src/worker/index.ts')
    expect(worker).toContain('assertProductionSecrets')
  })
})
