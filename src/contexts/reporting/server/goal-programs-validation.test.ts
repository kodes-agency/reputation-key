import { beforeEach, describe, expect, it, vi } from 'vitest'

type StandardValidator = Readonly<{
  '~standard': Readonly<{
    validate: (input: unknown) => Promise<{ issues?: ReadonlyArray<unknown> }>
  }>
}>

// Stands in for the server runtime, which applies `.validator()` before the
// handler: a server function declaring none, or a handler reached by a refused
// input, fails here.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validator: StandardValidator | null = null
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (context: { data: unknown }) => Promise<unknown>) {
        return async (options: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no validator')
          const parsed = await validator['~standard'].validate(options.data)
          if (parsed.issues) throw new Error('refused input')
          return fn({ data: options.data })
        }
      },
    }
    return builder
  },
}))

const mocks = vi.hoisted(() => ({ withGoalPrograms: vi.fn() }))
vi.mock('./goal-program-request.server', () => ({
  withGoalPrograms: mocks.withGoalPrograms,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import {
  getGoalListProgress,
  getGoalProgramHistory,
  getGoalProgress,
  listGoalPrograms,
} from './goal-programs'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'

describe('Goal Program read server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withGoalPrograms.mockResolvedValue({})
  })

  it.each([
    ['listGoalPrograms', listGoalPrograms],
    ['getGoalListProgress', getGoalListProgress],
  ] as const)(
    '%s refuses a Property id that is not a UUID before reading',
    async (_name, read) => {
      await expect(read({ data: { propertyId: 'not-a-uuid' } } as never)).rejects.toThrow(
        'refused input',
      )
      expect(mocks.withGoalPrograms).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['listGoalPrograms', listGoalPrograms],
    ['getGoalListProgress', getGoalListProgress],
  ] as const)('%s reads for a valid Property id', async (_name, read) => {
    await read({ data: { propertyId: PROPERTY_ID } } as never)

    expect(mocks.withGoalPrograms).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['getGoalProgress', getGoalProgress],
    ['getGoalProgramHistory', getGoalProgramHistory],
  ] as const)('%s refuses an empty input before reading', async (_name, read) => {
    await expect(read({ data: {} } as never)).rejects.toThrow('refused input')
    expect(mocks.withGoalPrograms).not.toHaveBeenCalled()
  })
})
