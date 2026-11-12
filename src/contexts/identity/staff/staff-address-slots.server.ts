import { staffAccountError } from '../domain/staff-account'

const ACTIVE_LIMIT = 4
const WAITER_LIMIT = 40
const WAIT_MS = 30_000

let active = 0
let waiters: readonly (() => void)[] = []
const busy = () =>
  staffAccountError('rate_limited', 'Staff changes are busy. Please try again shortly')

/**
 * One limit for the whole process: staff commands hold no connection between
 * their steps, so this bounds the work they put on the shared pool at once.
 */
export async function takeStaffOnboardingSlot(): Promise<() => void> {
  if (active < ACTIVE_LIMIT) {
    active += 1
    return once(release)
  }
  if (waiters.length >= WAITER_LIMIT) throw busy()
  await new Promise<void>((resolve, reject) => {
    const ready = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      waiters = waiters.filter((waiter) => waiter !== ready)
      reject(busy())
    }, WAIT_MS)
    waiters = [...waiters, ready]
  })
  return once(release)
}

function release(): void {
  const [next, ...rest] = waiters
  if (!next) {
    active -= 1
    return
  }
  // The slot passes straight to the next waiter, so `active` is unchanged.
  waiters = rest
  next()
}

function once(run: () => void): () => void {
  let done = false
  return () => {
    if (done) return
    done = true
    run()
  }
}
