type Conditions = Readonly<{
  shouldAutoOpen: boolean
  visible: boolean
  focused: boolean
  dialogOpen: boolean
}>

// Memory only: survives a shell refusal/remount, never persists a new browser key.

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
