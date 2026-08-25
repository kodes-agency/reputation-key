import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const build = readFileSync(join(process.cwd(), 'src/contexts/guest/build.ts'), 'utf8')

describe('Guest durable fact wiring', () => {
  it('forwards the outbox repository to scan and link producers', () => {
    const scanWiring = build.match(/recordScan:\s*recordScan\(\{(?<body>[\s\S]*?)\}\),/)
    const clickWirings = [
      ...build.matchAll(/trackReviewLinkClick\(\{(?<body>[\s\S]*?)\}\)/g),
    ]

    expect(scanWiring?.groups?.body).toContain('outboxRepo: deps.outboxRepo')
    expect(clickWirings).toHaveLength(2)
    for (const wiring of clickWirings) {
      expect(wiring.groups?.body).toContain('outboxRepo: deps.outboxRepo')
    }
  })
})
