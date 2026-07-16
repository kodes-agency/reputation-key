// BQR-5.1/5.2 critical path — hard CI gate.
// Auth bootstrap + authenticated shell for beta-enabled manager surfaces.
//
// Scope notes:
// - Self-service registration is a non-core capability (OFF in real beta).
//   Critical only asserts the capability surface opens under
//   BETA_E2E_GLOBAL_CAPABILITIES. Full register→sign-in lives in residual
//   e2e/auth.spec.ts (soft until green).
// - Property/inbox/members use seed-state deep-links (no UI property create).

import { test, expect } from '@playwright/test'
import { signIn } from '../helpers/auth'
import { openSeededProperty, SEEDED_PROPERTY_NAME } from '../helpers/property'
import { requireE2eSeedState } from '../helpers/seed-state'

test.describe('Critical: authentication', () => {
  test('sign in with seeded credentials reaches authenticated area', async ({ page }) => {
    await signIn(page)
    await expect(page).toHaveURL(/\/(dashboard|properties|home|inbox)/)
  })

  test('registration form is reachable when e2e capabilities are on', async ({
    page,
  }) => {
    await page.goto('/register')
    await page.waitForLoadState('domcontentloaded')
    // Capability off → redirect to /login. Capability on → create-account form.
    // AuthCard titles are divs (not heading roles).
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByText(/create your account/i)).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Organization name')).toBeVisible()
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
  })
})

test.describe('Critical: properties shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('properties list shows seeded property', async ({ page }) => {
    await page.goto('/properties')
    await expect(page.getByRole('heading', { name: /^properties$/i })).toBeVisible()
    await expect(page.getByText(SEEDED_PROPERTY_NAME)).toBeVisible()
  })

  test('open seeded property detail', async ({ page }) => {
    await openSeededProperty(page)
    await expect(page).toHaveURL(/\/properties\/[a-f0-9-]+/i)
    await expect(page.getByText(SEEDED_PROPERTY_NAME).first()).toBeVisible()
  })

  test('property reviews and people routes load', async ({ page }) => {
    const seed = requireE2eSeedState()
    await page.goto(`/properties/${seed.propertyId}/reviews`)
    await expect(page).toHaveURL(new RegExp(`/properties/${seed.propertyId}/reviews`))
    // Inbox-style reviews surface; empty state is OK for seed property.
    await expect(page.getByText(SEEDED_PROPERTY_NAME).first()).toBeVisible({
      timeout: 15_000,
    })

    await page.goto(`/properties/${seed.propertyId}/people`)
    await expect(page).toHaveURL(new RegExp(`/properties/${seed.propertyId}/people`))
    await expect(page.getByRole('tab', { name: /teams/i })).toBeVisible({
      timeout: 15_000,
    })
  })
})

test.describe('Critical: inbox and members shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('inbox triage surface loads for manager', async ({ page }) => {
    await page.goto('/inbox')
    await expect(page).toHaveURL(/\/inbox/)
    // Empty inbox is fine — assert the triage chrome is mounted.
    // EmptyState title is "No open items" (or similar folder label).
    await expect(
      page.getByRole('list', { name: /inbox items/i }).or(page.getByText(/no .+ items/i)),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('settings members page loads', async ({ page }) => {
    await page.goto('/settings/members')
    await expect(page).toHaveURL(/\/settings\/members/)
    // PageHeader title + section h2 both say Members — use first match.
    await expect(page.getByRole('heading', { name: /^members$/i }).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
