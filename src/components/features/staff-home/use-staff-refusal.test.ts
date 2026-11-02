import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { staffSelfKeys } from '#/shared/queries/query-keys'
import { shellContextKeys } from '#/shared/queries/shell-context-cache'
import { watchStaffRefusals } from './use-staff-refusal'
it('forgets the guard and leaves on refused staff reads, keeping infrastructure errors retryable', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const leave = vi.fn(),
    stop = watchStaffRefusals(client, leave)
  client.setQueryData(shellContextKeys.session(), { user: { id: 'polly' } })
  client.setQueryData(staffSelfKeys.home('polly'), { participations: [] })
  await expect(
    client.fetchQuery({
      queryKey: [...staffSelfKeys.all, 'failed'],
      queryFn: async () => {
        throw new Error('Unavailable')
      },
    }),
  ).rejects.toThrow('Unavailable')
  expect(leave).not.toHaveBeenCalled()
  await expect(
    client.fetchQuery({
      queryKey: [...staffSelfKeys.all, 'removed'],
      queryFn: async () => {
        throw new ServerFunctionError('AuthError', 'Removed', 'forbidden', 403)
      },
    }),
  ).rejects.toMatchObject({ status: 403 })
  expect(leave).toHaveBeenCalledOnce()
  expect(client.getQueryData(staffSelfKeys.home('polly'))).toBeUndefined()
  expect(client.getQueryData(shellContextKeys.session())).toBeUndefined()
  stop()
  client.clear()
})
