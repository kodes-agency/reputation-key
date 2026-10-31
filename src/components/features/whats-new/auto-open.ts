import type { ProductUpdatesView } from '#/shared/whats-new/types'

type Conditions = Readonly<{
  /** The rule says the modal is due: see `planAutoOpen`. */
  shouldAutoOpen: boolean
  visible: boolean
  focused: boolean
  dialogOpen: boolean
}>

// Memory only: survives a shell refusal/remount, never persists a new browser key.

/** How the modal gets to open by itself; `claim` is whether it must first win the server's claim. */
export type AutoOpenPlan = Readonly<{ claim: boolean }>

/**
 * Whether the modal may open by itself, and on what terms.
 *
 * The weekly rule is the server's `shouldAutoOpen` (an unseen highlight, at most
 * once in 7 days). It is won with the server's claim, so only one tab or device
 * opens it. A pending AI update is a second reason, for a person who left "Show
 * updates automatically" on: an AccountAdmin is always told, and it need not wait
 * out the week, so it skips the claim. When both hold the weekly rule wins, so
 * the opening still uses the week up. With the switch off nothing opens by itself.
 */
export function planAutoOpen(
  view: Pick<ProductUpdatesView, 'autoShow' | 'shouldAutoOpen'>,
  hasAiUpdate: boolean,
): AutoOpenPlan | null {
  if (view.shouldAutoOpen) return { claim: true }
  return view.autoShow && hasAiUpdate ? { claim: false } : null
}

/** Wins the opening: the server settles the weekly claim, an AI update needs none. */
export const winOpening = (plan: AutoOpenPlan, serverClaim: () => Promise<boolean>) =>
  plan.claim ? serverClaim() : Promise.resolve(true)

export const canAutoOpen = (conditions: Conditions) =>
  conditions.shouldAutoOpen &&
  conditions.visible &&
  conditions.focused &&
  !conditions.dialogOpen

export function createAutoOpenSession() {
  const people = new Set<string>()
  return {
    async attempt(
      person: string,
      conditions: () => Conditions,
      claim: () => Promise<boolean>,
      open: () => void,
    ) {
      if (people.has(person)) return
      people.add(person)
      if (!canAutoOpen(conditions())) return
      if ((await claim()) && canAutoOpen(conditions())) open()
    },
  }
}

export const productUpdatesSession = createAutoOpenSession()
