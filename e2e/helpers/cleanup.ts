// E2E cleanup helpers — delete test data via UI.
// These helpers perform cleanup through the actual UI (not DB) to keep
// E2E tests black-box. Use inline at the end of tests that create data.
//
// For accumulated cleanup across runs, see the standalone script at the
// bottom of this file.

import type { Page } from '@playwright/test'

/**
 * Delete a property by name from the properties list.
 * Assumes the caller is already authenticated.
 *
 * Usage:
 *   await deleteProperty(page, propertyName)
 */
export async function deleteProperty(page: Page) {
  // Navigate to properties list
  await page.goto('/properties')

  // Accept any confirmation dialog
  page.on('dialog', (dialog) => dialog.accept())

  // Click the first delete button on the page.
  // The properties list renders delete buttons for each property.
  await page
    .getByRole('button', { name: /delete property/i })
    .first()
    .click()
}

// ── Standalone DB cleanup script ─────────────────────────────────────────────
// Run manually or in CI after E2E to hard-delete accumulated test data.
//
//   npx tsx e2e/helpers/cleanup.ts
//
// This is NOT imported by E2E tests — it bypasses the UI and hits the DB
// directly. Keep it separate from the test suite to maintain black-box purity.

import { getDb } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { teams } from '#/shared/db/schema/team.schema'
import { like, or } from 'drizzle-orm'

async function runDbCleanup() {
  const db = getDb()
  console.log('Starting E2E DB cleanup...')

  // Properties with E2E names
  const deletedProperties = await db
    .delete(properties)
    .where(like(properties.name, 'E2E %'))
    .returning({ name: properties.name })
  console.log(`  Deleted ${deletedProperties.length} properties`)

  // Teams with E2E names (Front Desk / Housekeeping from team-management.spec.ts)
  const deletedTeams = await db
    .delete(teams)
    .where(or(like(teams.name, 'Front Desk %'), like(teams.name, 'Housekeeping %')))
    .returning({ name: teams.name })
  console.log(`  Deleted ${deletedTeams.length} teams`)

  console.log('E2E DB cleanup complete.')
}

// Only run when executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  runDbCleanup().catch((e) => {
    console.error('Cleanup failed:', e)
    process.exit(1)
  })
}
