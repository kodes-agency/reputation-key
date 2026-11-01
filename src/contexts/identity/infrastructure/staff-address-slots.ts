import { staffAccountError } from '../domain/staff-account'

type Slot = Readonly<{ active: number; waiters: readonly (() => void)[] }>
const slots = new Map<string, Slot>()
const busy = () =>
  staffAccountError('rate_limited', 'Staff changes are busy. Please try again shortly')

/** Leave pool capacity for Portal commits without letting one Organization queue everyone. */
export async function takeStaffAddressSlot(organizationId: string): Promise<() => void> {
  const current = slots.get(organizationId) ?? { active: 0, waiters: [] }
  if (current.active < 2) {
    slots.set(organizationId, { ...current, active: current.active + 1 })
    return () => release(organizationId)
  }
  if (current.waiters.length >= 20) throw busy()
  await new Promise<void>((resolve, reject) => {
    const ready = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      const latest = slots.get(organizationId)!
      slots.set(organizationId, {
        ...latest,
        waiters: latest.waiters.filter((waiter) => waiter !== ready),
      })
      reject(busy())
    }, 30_000)
    slots.set(organizationId, { ...current, waiters: [...current.waiters, ready] })
  })
  return () => release(organizationId)
}

function release(organizationId: string): void {
  const current = slots.get(organizationId)!
  const [next, ...waiters] = current.waiters
  if (next) {
    slots.set(organizationId, { ...current, waiters })
    next()
  } else if (current.active > 1)
    slots.set(organizationId, { active: current.active - 1, waiters: [] })
  else slots.delete(organizationId)
}
