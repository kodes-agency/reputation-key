// E2E: the invitation link pages (join, accept, login) from the invitee's side.
//
// An emailed link names one invitation. Before anything is created or
// accepted, the pages read it (an anonymous preview) and show what it offers,
// who sent it and as which role. Five journeys:
//
//   1. a new address lands on /join: the Organization, inviter, role and
//      Properties are shown and the invited email is locked;
//   2. an expired link says so, an AccountAdmin's Resend renews the same
//      invitation, and the same link works again;
//   3. an unverified member who signs in is told to verify, and "Send a new
//      link" mails exactly one message;
//   4. an address that already has an account goes to sign in, then to a
//      confirm step: opening the link never accepts, the button does;
//   5. a visitor signed in as someone else sees the mismatch card, and
//      signing out carries on as the invited address.
//
// Accounts and invitations are seeded directly (prefix-scoped, cleaned up
// after); the registration saga itself is covered by e2e/auth.spec.ts. The
// Members table's Resend button belongs to that page's own spec, so journey 2
// renews through the same server function the button calls.

import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { test, expect } from '../helpers/error-detection'
import { signIn, TEST_EMAIL } from '../helpers/auth'
import { clickWhenReady, waitForHydration } from '../helpers/interaction'
import { requireE2eSeedState } from '../helpers/seed-state'
import {
  callServerFn,
  cleanupE2eData,
  dbQuery,
  e2eRunId,
  resetGuestRateLimits,
} from '../helpers/fixtures'
import { mailStubControl } from '../fixtures/mail-stub'

const PREFIX = `e2e-invlink-${e2eRunId}-`
const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const PASSWORD = 'Password123!'
const seed = requireE2eSeedState()

type InvitationSeed = Readonly<{
  email: string
  /** Hours from now; negative for a lapsed invitation. */
  expiresInHours?: number
  propertyIds?: ReadonlyArray<string>
}>

/** A stored invitation for a PropertyManager ('admin'), invited by the seeded owner. */
async function seedInvitation(input: InvitationSeed): Promise<string> {
  const id = `${PREFIX}inv-${randomUUID().slice(0, 8)}`
  await dbQuery(
    `INSERT INTO invitation
       (id, "organizationId", email, role, status, "expiresAt", "propertyIds", "inviterId", "createdAt")
     VALUES ($1, $2, $3, 'admin', 'pending', NOW() + make_interval(hours => $4), $5, $6, NOW())`,
    [
      id,
      seed.organizationId,
      input.email,
      input.expiresInHours ?? 24,
      JSON.stringify(input.propertyIds ?? []),
      seed.managerUserId,
    ],
  )
  return id
}

/** A user with a password, optionally unverified and optionally already a member. */
async function seedAccount(input: {
  email: string
  emailVerified: boolean
  member?: boolean
}): Promise<void> {
  const userId = randomUUID()
  await dbQuery(
    'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, now(), now())',
    [userId, 'E2E Invitee', input.email, input.emailVerified],
  )
  await dbQuery(
    'INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, now(), now())',
    [`e2e-${randomUUID()}`, userId, 'credential', userId, await hashPassword(PASSWORD)],
  )
  if (input.member) {
    await dbQuery(
      'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())',
      [`e2e-${randomUUID()}`, seed.organizationId, userId, 'admin'],
    )
  }
}

async function invitationStatus(id: string): Promise<string | undefined> {
  const rows = await dbQuery<{ status: string }>(
    'SELECT status FROM invitation WHERE id = $1',
    [id],
  )
  return rows[0]?.status
}

const inviteeEmail = (label: string) => `${PREFIX}${label}@example.com`

test.describe('Critical workflow: invitation link pages', () => {
  test.beforeEach(async () => {
    // The preview, sign-in and resend limits are per network, and every spec
    // in the suite arrives from one. Give this journey a fresh budget.
    await resetGuestRateLimits()
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test.afterEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('a new address sees what it is joining, and cannot change the invited email', async ({
    page,
  }) => {
    const email = inviteeEmail('join')
    const id = await seedInvitation({ email, propertyIds: [seed.propertyId] })

    await page.goto(`/accept-invitation?id=${encodeURIComponent(id)}`)
    // No account for this address: the link goes to sign-up, not sign-in.
    await expect(page).toHaveURL(/\/join\?invitationId=/)
    await waitForHydration(page)

    const summary = page.getByLabel('Invitation details')
    await expect(summary).toContainText(seed.organizationName)
    await expect(summary).toContainText(seed.managerName)
    await expect(summary).toContainText('Property Manager')
    await expect(summary).toContainText(seed.propertyName)

    const emailField = page.getByLabel('Email')
    await expect(emailField).toHaveValue(email)
    await expect(emailField).toHaveAttribute('readonly', '')
    await expect(page.getByText('The invitation was sent to this address.')).toBeVisible()
    // Nothing was created by looking.
    expect(await invitationStatus(id)).toBe('pending')
  })

  test('an expired link says so, and a Resend renews the same link', async ({
    page,
    browser,
  }) => {
    const email = inviteeEmail('expired')
    const id = await seedInvitation({ email, expiresInHours: -24 })
    const link = `/accept-invitation?id=${encodeURIComponent(id)}`

    const card = page.locator('[data-slot="card"]')
    await page.goto(link)
    await expect(page.getByText('This invitation has expired')).toBeVisible()
    await expect(page.getByText(`Ask ${seed.managerName} to resend it`)).toBeVisible()
    await expect(card.getByRole('link', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('form')).toHaveCount(0)

    // The AccountAdmin who sent it renews it. The request is made from their
    // own browser context, as the Resend button does.
    const adminContext = await browser.newContext({ baseURL: BASE_ORIGIN })
    const adminPage = await adminContext.newPage()
    try {
      await signIn(adminPage, TEST_EMAIL, undefined, BASE_ORIGIN)
      const renewed = await callServerFn<{ emailSent: boolean }>(adminPage, {
        file: 'src/contexts/identity/server/organizations.invitations.ts',
        exportName: 'resendInvitation',
        data: { invitationId: id },
      })
      expect(renewed.emailSent).toBe(true)
    } finally {
      await adminContext.close()
    }

    await expect
      .poll(
        async () =>
          (await mailStubControl.sends()).filter((send) => send.to === email).length,
        { timeout: 15_000 },
      )
      .toBe(1)

    // The link the invitee already holds works again.
    await page.goto(link)
    await expect(page).toHaveURL(/\/join\?invitationId=/)
    await waitForHydration(page)
    await expect(page.getByLabel('Invitation details')).toContainText(
      seed.organizationName,
    )
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
  })

  // Sign-in refuses an unverified address with a 403: that refusal is what
  // this journey is about, so the gate tolerates it here and nowhere else.
  test.describe('unverified sign-in', () => {
    test.use({
      extraErrorAllowlist: [
        {
          id: 'unverified-sign-in-refusal',
          kind: 'mutation-status',
          pattern: '/_serverFn/',
          pagePattern: '/login',
          status: 403,
          owner: 'identity',
          reason:
            'The journey signs in as a member whose address is deliberately unverified; the 403 email_not_verified is the behaviour under test. One-year horizon because it is permanent, not a known defect.',
          expires: '2027-09-30',
        },
        {
          id: 'unverified-sign-in-refusal-echo',
          kind: 'console-error',
          pattern: /Failed to load resource: the server responded with a status of 403/,
          pagePattern: '/login',
          owner: 'identity',
          reason:
            "Chromium's network-log line for the 403 above; same scope, same horizon.",
          expires: '2027-09-30',
        },
      ],
    })

    test('an unverified member is told to verify, and gets exactly one new link', async ({
      page,
    }) => {
      const email = inviteeEmail('unverified')
      await seedAccount({ email, emailVerified: false, member: true })

      await page.goto('/login')
      await waitForHydration(page)
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Password').fill(PASSWORD)
      await clickWhenReady(page.getByRole('button', { name: /^sign in$/i }))

      await expect(page.getByText('Verify your email first')).toBeVisible()
      await expect(page).toHaveURL(/\/login/)

      await clickWhenReady(page.getByRole('button', { name: 'Send a new link' }))
      await expect(page.getByText(/new link is on its way/i)).toBeVisible()

      await expect
        .poll(
          async () =>
            (await mailStubControl.sends()).filter((send) => send.to === email).length,
          { timeout: 15_000 },
        )
        .toBe(1)
      const [send] = (await mailStubControl.sends()).filter((item) => item.to === email)
      expect(send?.subject).toMatch(/verify your email/i)
    })
  })

  test('an existing account signs in, then confirms: opening the link accepts nothing', async ({
    page,
  }) => {
    const email = inviteeEmail('existing')
    await seedAccount({ email, emailVerified: true })
    const id = await seedInvitation({ email, propertyIds: [seed.propertyId] })

    await page.goto(`/accept-invitation?id=${encodeURIComponent(id)}`)
    // The address has an account, so sign-up would only fail: sign in first,
    // with the way back to this link kept.
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await waitForHydration(page)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await clickWhenReady(page.getByRole('button', { name: /^sign in$/i }))

    await expect(page).toHaveURL(/\/accept-invitation\?id=/, { timeout: 20_000 })
    await expect(
      page.getByText(`Join ${seed.organizationName}`, { exact: true }),
    ).toBeVisible()
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
    // The confirm step waits for the person. Nothing has been accepted.
    expect(await invitationStatus(id)).toBe('pending')

    await clickWhenReady(page.getByRole('button', { name: 'Accept and join' }))
    await expect(page.getByText('Welcome to the team!')).toBeVisible()
    expect(await invitationStatus(id)).toBe('accepted')
  })

  test('someone signed in as another address sees the mismatch, and signing out carries on', async ({
    page,
  }) => {
    const email = inviteeEmail('mismatch')
    const id = await seedInvitation({ email })
    await signIn(page, TEST_EMAIL, undefined, BASE_ORIGIN)

    await page.goto(`/accept-invitation?id=${encodeURIComponent(id)}`)
    await waitForHydration(page)
    await expect(page.getByText('This invitation is for another address')).toBeVisible()
    const card = page.locator('[data-slot="card"]')
    await expect(card).toContainText(email)
    await expect(card).toContainText(TEST_EMAIL)
    await expect(page.getByRole('button', { name: 'Accept and join' })).toHaveCount(0)
    expect(await invitationStatus(id)).toBe('pending')

    await clickWhenReady(page.getByRole('button', { name: 'Sign out' }))

    // Signed out, the same link is a new address's sign-up.
    await expect(page).toHaveURL(/\/join\?invitationId=/, { timeout: 20_000 })
    await waitForHydration(page)
    await expect(page.getByLabel('Email')).toHaveValue(email)
    expect(await invitationStatus(id)).toBe('pending')
  })
})
