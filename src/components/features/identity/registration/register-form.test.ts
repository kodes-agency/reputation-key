import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AnyAction } from '#/components/hooks/use-action'
import { RegisterForm } from './register-form'

const mutation: AnyAction = Object.assign(async () => ({}), {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
})

const render = (props: Partial<Parameters<typeof RegisterForm>[0]>) =>
  renderToStaticMarkup(
    createElement(RegisterForm, {
      mode: 'join',
      mutation,
      invitationId: 'inv-1',
      ...props,
    }),
  )

// The email input is the one carrying `type="email"`.
const emailInput = (html: string) => /<input[^>]*type="email"[^>]*>/.exec(html)?.[0] ?? ''

describe('RegisterForm join mode with a locked email', () => {
  it('prefills the invited address and does not let it be edited', () => {
    const input = emailInput(render({ lockedEmail: 'new.hire@meridian.test' }))

    expect(input).toContain('value="new.hire@meridian.test"')
    expect(input).toContain('readOnly=""')
  })

  it('says why the address cannot change', () => {
    const html = render({ lockedEmail: 'new.hire@meridian.test' })

    expect(html).toContain('The invitation was sent to this address.')
    expect(emailInput(html)).toContain('aria-describedby="join-email-description"')
  })

  it('leaves the address open when nothing locks it', () => {
    const input = emailInput(render({}))

    expect(input).toContain('value=""')
    expect(input).not.toContain('readOnly')
  })
})
