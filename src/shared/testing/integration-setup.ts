import { afterAll, afterEach } from 'vitest'
import { setImmediate } from 'node:timers/promises'
import { createPgQueryWarningGuard } from './pg-query-warning-guard'

const guard = createPgQueryWarningGuard()
process.on('warning', guard.onWarning)

// Node delivers warnings on the next tick, including ones emitted during cleanup.
afterEach(async () => {
  await setImmediate()
  guard.assertNoWarnings()
})

afterAll(async () => {
  await setImmediate()
  process.off('warning', guard.onWarning)
  guard.assertNoWarnings()
})
