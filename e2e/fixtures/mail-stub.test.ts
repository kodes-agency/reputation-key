import { afterEach, describe, expect, it } from 'vitest'
import { startMailStub, type MailStub } from './mail-stub'

let targetStub: MailStub | undefined

afterEach(async () => {
  await targetStub?.stop()
  targetStub = undefined
})

describe('mail stub target binding', () => {
  it('serves the control health check when bound to every interface', async () => {
    targetStub = await startMailStub(4202, '0.0.0.0')
    expect(targetStub.host).toBe('0.0.0.0')

    const response = await fetch('http://127.0.0.1:4202/__control/health')

    expect(response.status).toBe(200)
  })
})
