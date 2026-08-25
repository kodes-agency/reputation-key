import { fileURLToPath } from 'node:url'

export type SimulationInvocation = Readonly<{
  file: string
  args: readonly string[]
  options: Readonly<{ shell: false }>
}>

/** Build an argv-only invocation; database values never enter shell source text. */
export function buildSimulationInvocation(organizationId: string): SimulationInvocation {
  return Object.freeze({
    file: process.execPath,
    args: Object.freeze([
      fileURLToPath(import.meta.resolve('tsx/cli')),
      'scripts/seed.ts',
      `--org=${organizationId}`,
      '--invariants',
    ]),
    options: Object.freeze({ shell: false as const }),
  })
}
