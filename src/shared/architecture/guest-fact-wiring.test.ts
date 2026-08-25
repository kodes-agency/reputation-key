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
  it('routes scan and link observations through the atomic observation store', () => {
    expect(build).toContain('createAtomicGuestObservationStore')
    expect(build.match(/observationStore:\s*guestObservationStore/g)).toHaveLength(3)
  })

  it('commits response state and facts through the atomic Guest command store', () => {
    expect(build).toContain('createAtomicGuestResponseCommandStore')
    expect(build).toMatch(
      /guestResponseLifecycle\(\{[\s\S]*?commandStore:\s*guestResponseCommandStore/,
    )
    expect(responseLifecycle).toContain('commandStore.commitSubmitted')
    expect(responseLifecycle).not.toContain('emitAndRecord')
  })

  it('contains no split post-commit outbox writes in the Guest context', () => {
    expect(build).not.toContain('outboxRepo')
    expect(responseLifecycle).not.toContain('emitAndRecord')
  })
})
