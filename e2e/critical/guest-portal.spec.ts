import { test, expect } from '../helpers/error-detection'
import { requireE2eSeedState } from '../helpers/seed-state'
import { attachRequestLog } from '../helpers/request-log'
import {
  callServerFn,
  callServerFnExpectError,
  callServerFnGet,
} from '../helpers/fixtures'

const seed = requireE2eSeedState()
const guestMutationServerFile = 'src/contexts/guest/server/public.ts'
const guestQueryServerFile = 'src/contexts/guest/server/guest-scans.ts'
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zf1sAAAAASUVORK5CYII=',
  'base64',
)

test.describe('Critical: public Portal basics', () => {
  test('published P1 token renders content and destinations without requiring a response', async ({
    page,
    context,
  }) => {
    const log = attachRequestLog(page)
    await page.goto(`/p/${seed.portalToken}`)

    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '1 star' })).toBeVisible()
    const sessionCookies = (await context.cookies()).filter(
      (cookie) => cookie.name === 'rk_guest_session',
    )
    expect(sessionCookies.map((cookie) => cookie.path).sort()).toEqual([
      '/_serverFn/',
      '/p/',
    ])
    expect(sessionCookies.every((cookie) => cookie.httpOnly)).toBe(true)
    expect(sessionCookies.every((cookie) => cookie.sameSite === 'Lax')).toBe(true)
    expect(sessionCookies.every((cookie) => cookie.secure)).toBe(true)
    await expect(page.getByRole('radio', { name: '5 stars' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Visit example review destination' }),
    ).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E Guest Portal P1' })).toBeVisible()
    expect(log.requests.some((request) => request.url.includes(seed.portalToken))).toBe(
      true,
    )
  })

  test('guest response, media, one correction, and withdrawal survive reload', async ({
    page,
  }) => {
    await page.goto(`/p/${seed.portalToken}`)
    const destination = page.getByRole('link', {
      name: 'Visit example review destination',
    })
    const expectedDestination = `/api/public/p/${encodeURIComponent(seed.portalToken)}/click/${seed.portalLinkId}`
    await expect(destination).toHaveAttribute('href', expectedDestination)

    await page.getByRole('radio', { name: '2 stars' }).check()
    await page.getByLabel('Share this rating with the property team.').check()
    await page
      .getByRole('textbox', { name: 'Written feedback' })
      .fill('Initial private guest response.')
    await page.getByLabel('Share this written feedback with the property team.').check()
    await page.locator('input[type="file"]').setInputFiles({
      name: 'guest-proof.png',
      mimeType: 'image/png',
      buffer: tinyPng,
    })
    await page.getByLabel('Share this image with the property team.').check()
    await page.getByRole('button', { name: 'Submit response' }).click()
    await expect(
      page.getByText(
        'Your optional response was submitted. You may correct it once for one hour.',
      ),
    ).toBeVisible()
    await expect(destination).toHaveAttribute('href', expectedDestination)

    await page.reload()
    await expect(page.getByRole('button', { name: 'Save one correction' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Written feedback' })).toHaveValue(
      'Initial private guest response.',
    )
    await page.getByRole('radio', { name: '5 stars' }).check()
    await page
      .getByRole('textbox', { name: 'Written feedback' })
      .fill('Corrected private guest response.')
    await page.getByRole('button', { name: 'Save one correction' }).click()
    await expect(
      page.getByText('Your response was corrected. You can still withdraw it.'),
    ).toBeVisible()
    await expect(destination).toHaveAttribute('href', expectedDestination)

    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Written feedback' })).toHaveValue(
      'Corrected private guest response.',
    )
    await page.getByRole('button', { name: 'Withdraw response' }).click()
    await expect(
      page.getByText('Your response was withdrawn and its content was removed.'),
    ).toBeVisible()
    await page.reload()
    await expect(page.getByText('Your response has been withdrawn.')).toBeVisible()
    await expect(page.getByText('Corrected private guest response.')).toHaveCount(0)
    await expect(destination).toHaveAttribute('href', expectedDestination)
  })

  test('guest replay is idempotent and queued media cannot survive withdrawal', async ({
    page,
  }) => {
    await page.goto(`/p/${seed.portalToken}`)
    const loaded = await callServerFnGet<{
      guestSession: { csrfNonce: string }
      response: null
    }>(page, {
      file: guestQueryServerFile,
      exportName: 'getPublicPortal',
      data: { token: seed.portalToken },
    })
    const payload = {
      token: seed.portalToken,
      csrfNonce: loaded.guestSession.csrfNonce,
      rating: 4,
      text: null,
      responseConsent: true,
      textConsent: false,
      mediaConsent: true,
    }
    const first = await callServerFn<{ id: string; status: string }>(page, {
      file: guestMutationServerFile,
      exportName: 'submitGuestResponseFn',
      data: payload,
    })
    const replay = await callServerFn<{ id: string; status: string }>(page, {
      file: guestMutationServerFile,
      exportName: 'submitGuestResponseFn',
      data: payload,
    })
    expect(replay).toEqual(first)
    const persisted = await callServerFnGet<{
      response: { id: string; status: string; rating: number }
    }>(page, {
      file: guestQueryServerFile,
      exportName: 'getPublicPortal',
      data: { token: seed.portalToken },
    })
    expect(persisted.response).toMatchObject({
      id: first.id,
      status: 'submitted',
      rating: 4,
    })

    const issuance = await callServerFn<{
      mediaId: string
      objectKey: string
      uploadUrl: string
      contentType: string
    }>(page, {
      file: guestMutationServerFile,
      exportName: 'issueGuestMediaFn',
      data: {
        token: seed.portalToken,
        csrfNonce: loaded.guestSession.csrfNonce,
        contentType: 'image/png',
        sizeBytes: tinyPng.byteLength,
      },
    })
    const upload = await page.request.put(issuance.uploadUrl, {
      headers: { 'content-type': issuance.contentType },
      data: tinyPng,
    })
    expect(upload.ok()).toBe(true)

    await callServerFn(page, {
      file: guestMutationServerFile,
      exportName: 'withdrawGuestResponseFn',
      data: {
        token: seed.portalToken,
        csrfNonce: loaded.guestSession.csrfNonce,
      },
    })
    const withdrawn = await callServerFnGet<{
      response: { id: string; status: string; rating: null; text: null }
    }>(page, {
      file: guestQueryServerFile,
      exportName: 'getPublicPortal',
      data: { token: seed.portalToken },
    })
    expect(withdrawn.response).toMatchObject({
      id: first.id,
      status: 'deleted',
      rating: null,
      text: null,
    })
    const confirmAfterWithdrawal = await callServerFnExpectError(page, {
      file: guestMutationServerFile,
      exportName: 'confirmGuestMediaFn',
      data: {
        token: seed.portalToken,
        csrfNonce: loaded.guestSession.csrfNonce,
        mediaId: issuance.mediaId,
        objectKey: issuance.objectKey,
      },
    })
    expect(confirmAfterWithdrawal.message ?? '').toMatch(/error|request|completed/i)
    await page.reload()
    await expect(page.getByText('Your response has been withdrawn.')).toBeVisible()
  })

  test('oversize and cross-property guest mutations are inert', async ({ page }) => {
    await page.goto(`/p/${seed.portalToken}`)
    const loaded = await callServerFnGet<{ guestSession: { csrfNonce: string } }>(page, {
      file: guestQueryServerFile,
      exportName: 'getPublicPortal',
      data: { token: seed.portalToken },
    })
    const oversize = await callServerFnExpectError(page, {
      file: guestMutationServerFile,
      exportName: 'issueGuestMediaFn',
      data: {
        token: seed.portalToken,
        csrfNonce: loaded.guestSession.csrfNonce,
        contentType: 'image/png',
        sizeBytes: 10 * 1024 * 1024 + 1,
      },
    })
    expect(oversize.message ?? '').toMatch(/error|invalid|large|too big/i)
    const crossProperty = await callServerFnExpectError(page, {
      file: guestMutationServerFile,
      exportName: 'submitGuestResponseFn',
      data: {
        token: seed.p2PortalToken,
        csrfNonce: loaded.guestSession.csrfNonce,
        rating: 5,
        responseConsent: true,
      },
    })
    expect(crossProperty.message ?? '').toMatch(/error|request|completed/i)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Submit response' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save one correction' })).toHaveCount(0)
  })

  test('P2 and P3 tokens are externally indistinguishable', async ({ page }) => {
    for (const token of [seed.p2PortalToken, seed.p3PortalToken]) {
      await page.goto(`/p/${token}`)
      await expect(
        page.getByRole('heading', { name: 'Portal Unavailable' }),
      ).toBeVisible()
      await expect(page.getByText('Please try again later.')).toBeVisible()
      await expect(page.getByText(/E2E Guest Portal P[23]/)).toHaveCount(0)
    }
  })
})
