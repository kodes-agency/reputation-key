import { act, createElement, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import { createKeys } from '#/shared/queries/query-keys'
import { useStaffCode } from './use-staff-code'
import { watchStaffRefusals } from './use-staff-refusal'
import { STAFF_HOME_FNS } from './staff-home-fixtures'

const { staffSelfKeys } = createKeys({ userId: 'polly', organizationId: null })

vi.mock('#/components/features/portal/portal-share/portal-qr', () => ({
  renderQrPreviewDataUrl: async (qr: string) => `image:${qr}`,
}))
const root = setupHookRoot()
const live = {
  state: 'live' as const,
  qr: 'first',
  wordingKey: 'en' as const,
  headline: 'How did we do?',
  subline: 'About 30 seconds',
  cue: 'Scan with your camera',
}
let current: Pick<ReturnType<typeof useStaffCode>, 'data' | 'isPending' | 'isFetching'>
it('keeps the rendered code while checking on return, replaces it and retains it on failure or rate limit', async () => {
  const client = new QueryClient()
  const read = vi.fn(STAFF_HOME_FNS.getMyCode).mockResolvedValue(live)
  function Screen({ show }: { show: boolean }) {
    return show ? createElement(Code) : null
  }
  function Code() {
    const query = useStaffCode(read, 'own', false)
    current = {
      data: query.data,
      isPending: query.isPending,
      isFetching: query.isFetching,
    }
    return null
  }
  const draw = (show: boolean) =>
    root.render(
      createElement(QueryClientProvider, { client }, createElement(Screen, { show })),
    )
  await draw(true)
  expect(current.data).toMatchObject({ ...live, preview: 'image:first' })
  await draw(false)
  let resolve: (code: typeof live) => void = () => undefined
  read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await draw(true)
  expect(current.isFetching).toBe(true)
  expect(current.data?.state).toBe('live')
  await act(async () => resolve({ ...live, qr: 'replacement' }))
  await root.flush()
  expect(current.data).toMatchObject({ qr: 'replacement', preview: 'image:replacement' })
  for (const error of [new Error('Connection failed.'), { status: 429 }]) {
    read.mockRejectedValueOnce(error)
    await act(async () => client.refetchQueries({ queryKey: staffSelfKeys.code('own') }))
    await root.flush()
    expect(current.data).toMatchObject({ qr: 'replacement' })
  }
  read.mockResolvedValueOnce({ state: 'paused' })
  await act(async () => client.refetchQueries({ queryKey: staffSelfKeys.code('own') }))
  await root.flush()
  expect(current.data).toEqual({ state: 'paused' })
  client.clear()
})
it('starts empty on a fresh app open and removes the retained code when access ends', async () => {
  const client = new QueryClient()
  const read = vi.fn().mockImplementation(() => new Promise(() => undefined))
  let hide: () => void = () => undefined
  function Code() {
    const query = useStaffCode(read, 'own', false)
    current = {
      data: query.data,
      isPending: query.isPending,
      isFetching: query.isFetching,
    }
    return null
  }
  function Host() {
    const [show, setShow] = useState(true)
    hide = () => setShow(false)
    return show ? createElement(Code) : null
  }
  await root.render(createElement(QueryClientProvider, { client }, createElement(Host)))
  expect(current.isPending).toBe(true)
  expect(current.data).toBeUndefined()
  await act(async () => {
    client.setQueryData(staffSelfKeys.code('own'), live)
  })
  const leave = vi.fn(() => hide())
  const stop = watchStaffRefusals(client, leave)
  read.mockRejectedValue({ status: 403 })
  await client.cancelQueries()
  await act(async () => client.refetchQueries({ queryKey: staffSelfKeys.code('own') }))
  await root.flush()
  expect(leave).toHaveBeenCalledOnce()
  expect(client.getQueryData(staffSelfKeys.code('own'))).toBeUndefined()
  stop()
  client.clear()
})

vi.mock('#/shared/hooks/useTenantScope', () => ({
  useTenantScope: () => ({ userId: 'polly', organizationId: null }),
}))
