/**
 * The import wizard's frame (decision 17): five steps from a Google account
 * to configured properties. The step on screen is derived from where the
 * import flow is, never stored, so a reload or a resumed import lands on the
 * same step.
 */
export const SETUP_WIZARD_STEPS = Object.freeze([
  { id: 'connect', title: 'Connect Google', description: 'Choose the account' },
  { id: 'locations', title: 'Choose locations', description: 'Pick what to import' },
  { id: 'confirm', title: 'Confirm details', description: 'Check each property' },
  { id: 'import', title: 'Import', description: 'Create the properties' },
  { id: 'setup', title: 'Set up properties', description: 'Language, managers, AI' },
] as const)

export type SetupWizardStepId = (typeof SETUP_WIZARD_STEPS)[number]['id']

type DiscoveryPosition = Readonly<{
  connections: ReadonlyArray<Readonly<{ status: string }>>
  connectionId: string | null
  step: 'discover' | 'review' | 'progress'
}>

/** Where the discovery and confirm screens are in the wizard. */
export function discoveryWizardStep(position: DiscoveryPosition): SetupWizardStepId {
  const hasActiveConnection = position.connections.some(
    (connection) => connection.status === 'active',
  )
  if (!hasActiveConnection || position.connectionId === null) return 'connect'
  return position.step === 'review' ? 'confirm' : 'locations'
}

/**
 * The import screen becomes "Set up properties" once the import has settled
 * and produced at least one property to set up.
 */
export function importWizardStep(
  position: Readonly<{ settled: boolean; importedPropertyCount: number }>,
): SetupWizardStepId {
  return position.settled && position.importedPropertyCount > 0 ? 'setup' : 'import'
}

export function setupWizardStepPosition(id: SetupWizardStepId): Readonly<{
  number: number
  total: number
  title: string
}> {
  const index = SETUP_WIZARD_STEPS.findIndex((step) => step.id === id)
  return {
    number: index + 1,
    total: SETUP_WIZARD_STEPS.length,
    title: SETUP_WIZARD_STEPS[index]!.title,
  }
}
