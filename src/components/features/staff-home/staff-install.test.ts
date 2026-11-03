import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import {
  staffInstallKind,
  StaffInstallContent,
  useStaffInstall,
  STAFF_INSTALL_SEEN,
} from './staff-install'
const root = setupHookRoot()
it('offers the two taps only for iPhone Safari and never in an installed app', () => {
  const safari = 'iPhone Version/18.0 Mobile Safari/604.1'
  expect(staffInstallKind(safari, false)).toBe('iphone')
  expect(staffInstallKind(safari, true)).toBeNull()
  expect(staffInstallKind('iPhone CriOS/123 Safari/604.1', false)).toBeNull()
  expect(staffInstallKind('Android Chrome/123', false)).toBeNull()
  const html = renderToStaticMarkup(
    createElement(StaffInstallContent, {
      kind: 'iphone',
      onInstall: vi.fn(),
      onSkip: vi.fn(),
    }),
  )
  expect(html).toContain('at the bottom of Safari')
  expect(html).toContain('Add to Home Screen')
  expect(html).toContain('Keep your code one tap away')
})
it('waits for a real Android prompt, installs once and remembers Skip on this device', async () => {
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key),
    setItem: (key: string, value: string) => memory.set(key, value),
  })
  let current: ReturnType<typeof useStaffInstall>
  function Screen() {
    current = useStaffInstall()
    return null
  }
  await root.render(createElement(Screen))
  expect(current!.kind).toBeNull()
  const prompt = vi.fn(async () => undefined)
  const offer = () =>
    window.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt,
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      }),
    )
  await act(async () => {
    offer()
  })
  expect(current!.kind).toBe('android')
  await act(async () => current!.install())
  expect(prompt).toHaveBeenCalledOnce()
  expect(memory.get(STAFF_INSTALL_SEEN)).toBe('yes')
  expect(current!.kind).toBeNull()
  await act(async () => {
    offer()
  })
  expect(current!.kind).toBeNull()
})

it('remembers the iPhone step on this device and offers it on a new device', async () => {
  const memory = new Map<string, string>()
  vi.stubGlobal('navigator', {
    userAgent: 'iPhone Version/18.0 Mobile Safari/604.1',
    standalone: false,
  })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key),
    setItem: (key: string, value: string) => memory.set(key, value),
  })
  let current: ReturnType<typeof useStaffInstall>
  function Screen() {
    current = useStaffInstall()
    return null
  }
  await root.render(createElement(Screen))
  expect(current!.kind).toBe('iphone')
  await act(async () => current!.finish())
  expect(current!.kind).toBeNull()
  await root.render(null)
  await root.render(createElement(Screen))
  expect(current!.kind).toBeNull()
  memory.clear()
  await root.render(null)
  await root.render(createElement(Screen))
  expect(current!.kind).toBe('iphone')
})
it('never offers the step when navigator says this is the installed app', async () => {
  vi.stubGlobal('navigator', {
    userAgent: 'iPhone Version/18.0 Mobile Safari/604.1',
    standalone: true,
  })
  vi.stubGlobal('localStorage', { getItem: () => null })
  let current: ReturnType<typeof useStaffInstall>
  function Screen() {
    current = useStaffInstall()
    return null
  }
  await root.render(createElement(Screen))
  expect(current!.kind).toBeNull()
})

const androidBrowser = () => {
  vi.stubGlobal('navigator', { userAgent: 'Android Chrome/123', standalone: false })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
}

const installOffer = () =>
  Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: async () => undefined,
    userChoice: Promise.resolve({ outcome: 'dismissed' }),
  })

it('never offers the step inside the manager shell, which has no manifest', async () => {
  androidBrowser()
  let current: ReturnType<typeof useStaffInstall>
  function Screen() {
    current = useStaffInstall(false)
    return null
  }
  await root.render(createElement(Screen))
  await act(async () => {
    window.dispatchEvent(installOffer())
  })
  expect(current!.kind).toBeNull()
})

it('does not take the screen from someone already using their code', async () => {
  androidBrowser()
  const opened = Date.now()
  const now = vi.spyOn(Date, 'now').mockReturnValue(opened)
  let current: ReturnType<typeof useStaffInstall>
  function Screen() {
    current = useStaffInstall()
    return null
  }
  await root.render(createElement(Screen))
  now.mockReturnValue(opened + 6_000)
  const late = installOffer()
  await act(async () => {
    window.dispatchEvent(late)
  })
  expect(current!.kind).toBeNull()
  // Left to the browser, which offers its own quiet install.
  expect(late.defaultPrevented).toBe(false)
  now.mockRestore()
})

it('still offers the step in the moment after opening', async () => {
  androidBrowser()
  const opened = Date.now()
  const now = vi.spyOn(Date, 'now').mockReturnValue(opened)
  let current: ReturnType<typeof useStaffInstall>
  function Screen() {
    current = useStaffInstall()
    return null
  }
  await root.render(createElement(Screen))
  now.mockReturnValue(opened + 2_000)
  await act(async () => {
    window.dispatchEvent(installOffer())
  })
  expect(current!.kind).toBe('android')
  now.mockRestore()
})
