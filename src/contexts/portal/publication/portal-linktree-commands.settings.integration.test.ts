// Linktree settings (the section title and the switch) against real PostgreSQL: each change and the pending-change rows it records.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { portalUpdated } from '../domain/events'
import {
  base,
  CREATED_AT,
  MANAGER,
  ORG_A,
  pageEdits,
  pageEditWording,
  pendingKeys,
  PORTAL_A,
  PROPERTY_A,
  saveSettings,
  seedPublishedSnapshot,
  setupLinktreeCommandsTestDb,
  store,
} from './portal-linktree-commands.test-fixtures'

const { getPool } = setupLinktreeCommandsTestDb()

describe.sequential('Linktree commands (real PostgreSQL)', () => {
  describe('Linktree settings', () => {
    const settings = async () =>
      (
        await getPool().query(
          `SELECT linktree_enabled FROM portals WHERE organization_id = $1 AND id = $2`,
          [ORG_A, PORTAL_A],
        )
      ).rows[0].linktree_enabled as boolean

    const titleRows = async () =>
      (
        await getPool().query(
          `SELECT locale, title, linktree_title, version FROM portal_localized_overrides
           WHERE organization_id = $1 AND portal_id = $2 ORDER BY locale`,
          [ORG_A, PORTAL_A],
        )
      ).rows

    it('starts on, and the switch is recorded as a pending change', async () => {
      await seedPublishedSnapshot()
      expect(await settings()).toBe(true)

      await saveSettings({ enabled: false })

      expect(await settings()).toBe(false)
      expect(await pendingKeys()).toEqual(['portal_links|linktree:enabled'])
      expect(await pageEdits()).toEqual([`portal_links|linktree:enabled|${MANAGER}`])
    })

    it('records nothing when the switch already has that value', async () => {
      await seedPublishedSnapshot()

      await saveSettings({ enabled: true })

      expect(await pendingKeys()).toEqual([])
      expect(await pageEdits()).toEqual([])
    })

    it('saves a title per language and records each as pending', async () => {
      await seedPublishedSnapshot()

      await saveSettings({
        titles: [
          { locale: 'en', title: 'Around town' },
          { locale: 'bg', title: 'Из града' },
        ],
      })

      expect(await titleRows()).toEqual([
        { locale: 'bg', title: null, linktree_title: 'Из града', version: 1 },
        { locale: 'en', title: null, linktree_title: 'Around town', version: 1 },
      ])
      expect(await pendingKeys()).toEqual([
        'portal_links|linktree:title:bg',
        'portal_links|linktree:title:en',
      ])
      expect(await pageEdits()).toEqual([
        `portal_links|linktree:title:bg|${MANAGER}`,
        `portal_links|linktree:title:en|${MANAGER}`,
      ])
      const wording = await pageEditWording()
      expect(wording.get('linktree:title:en')).toEqual([null, 'Around town', 1])
      expect(wording.get('linktree:title:bg')).toEqual([null, 'Из града', 1])
    })

    it('keeps the title that was reset as the text before, with none after', async () => {
      await saveSettings({ titles: [{ locale: 'en', title: 'Around town' }] })
      // The first save is history by now: nothing folds into it.
      await getPool().query('DELETE FROM portal_page_edits WHERE organization_id = $1', [
        ORG_A,
      ])
      await saveSettings({ titles: [{ locale: 'en', title: null }] })

      expect((await pageEditWording()).get('linktree:title:en')).toEqual([
        'Around town',
        null,
        1,
      ])
    })

    it('bumps the row version on a changed title and skips an unchanged one', async () => {
      await saveSettings({ titles: [{ locale: 'en', title: 'Around town' }] })
      await saveSettings({ titles: [{ locale: 'en', title: 'Around town' }] })
      expect((await titleRows())[0]?.version).toBe(1)

      await saveSettings({ titles: [{ locale: 'en', title: 'Nearby' }] })

      expect((await titleRows())[0]).toMatchObject({
        linktree_title: 'Nearby',
        version: 2,
      })
    })

    it('deletes a row that only held the title when the title is reset', async () => {
      await saveSettings({ titles: [{ locale: 'en', title: 'Around town' }] })

      await saveSettings({ titles: [{ locale: 'en', title: null }] })

      expect(await titleRows()).toEqual([])
    })

    it('keeps a row that also carries other override fields when the title is reset', async () => {
      await getPool().query(
        `INSERT INTO portal_localized_overrides
           (id, organization_id, property_id, portal_id, locale, title, linktree_title,
            version, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'en', 'Lobby', 'Around town', 1, $5, $6, $6)`,
        [randomUUID(), ORG_A, PROPERTY_A, PORTAL_A, MANAGER, CREATED_AT],
      )

      await saveSettings({ titles: [{ locale: 'en', title: null }] })

      expect(await titleRows()).toEqual([
        { locale: 'en', title: 'Lobby', linktree_title: null, version: 2 },
      ])
    })

    it('refuses a title in a language the Portal does not offer', async () => {
      await expect(
        saveSettings({ titles: [{ locale: 'de' as 'en', title: 'Nützlich' }] }),
      ).rejects.toMatchObject({ code: 'locale_not_offered' })

      expect(await titleRows()).toEqual([])
    })

    it('fences on the Portal revision', async () => {
      const command = await base()

      await expect(
        store().savePortalLinktreeSettings({
          ...command,
          expectedPortalUpdatedAt: new Date(
            command.expectedPortalUpdatedAt.getTime() - 1,
          ),
          actorUserId: MANAGER,
          enabled: false,
          titles: [],
          event: portalUpdated({
            portalId: PORTAL_A,
            organizationId: ORG_A,
            propertyId: PROPERTY_A,
            previousPublicationState: 'published',
            publicationState: 'published',
            sourceAggregateVersion: command.revision.toISOString(),
            occurredAt: command.occurredAt,
          }),
        }),
      ).rejects.toMatchObject({ code: 'revision_conflict' })

      expect(await settings()).toBe(true)
    })
  })
})
