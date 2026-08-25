import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const build = readFileSync(join(process.cwd(), 'src/contexts/guest/build.ts'), 'utf8')
const responseLifecycle = readFileSync(
  join(
    process.cwd(),
    'src/contexts/guest/application/use-cases/guest-response-lifecycle.ts',
  ),
  'utf8',
)

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

  it('commits response state and facts through the atomic Guest command store', () => {
    expect(build).toContain('createAtomicGuestResponseCommandStore')
    expect(build).toMatch(
      /guestResponseLifecycle\(\{[\s\S]*?commandStore:\s*guestResponseCommandStore/,
    )
    expect(responseLifecycle).toContain('commandStore.commitSubmitted')
    expect(responseLifecycle).not.toContain('emitAndRecord')
  })
})
