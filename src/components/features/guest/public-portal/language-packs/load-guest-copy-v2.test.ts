import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GUEST_LANGUAGE_PACKS,
  GUEST_LOCALES,
  OFFERED_GUEST_LOCALES,
} from '#/shared/domain/guest-locale'
import { loadGuestPortalCopyV2 } from './load-guest-copy-v2'

const SRC = join(import.meta.dirname, '..', '..', '..', '..', '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? sourceFiles(full) : [full]
  })
}

describe('loadGuestPortalCopyV2', () => {
  it('returns the one pack that was asked for', async () => {
    const en = await loadGuestPortalCopyV2('en')
    const bg = await loadGuestPortalCopyV2('bg')
    expect(en).toMatchObject({ locale: 'en', version: 'guest-ui-en-v2' })
    expect(bg).toMatchObject({ locale: 'bg', version: 'guest-ui-bg-v2' })
    expect(Object.keys(en).sort()).toEqual(['copy', 'locale', 'plurals', 'version'])
  })

  it('loads the pinned version when the snapshot names one', async () => {
    const pack = await loadGuestPortalCopyV2('bg', 'guest-ui-bg-v2')
    expect(pack.copy.ratingSend).toBe('Изпрати поверително')
  })

  it('throws when the pinned pack belongs to another locale', async () => {
    await expect(loadGuestPortalCopyV2('bg', 'guest-ui-en-v2')).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
  })

  it('throws for a v1 pack, an unknown version and a non-string', async () => {
    await expect(loadGuestPortalCopyV2('en', 'guest-ui-en-v1')).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
    await expect(loadGuestPortalCopyV2('en', 'guest-ui-en-v9')).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
    await expect(loadGuestPortalCopyV2('en', 2)).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
  })

  it('throws for a locale that has no reviewed v2 pack instead of showing another language', async () => {
    await expect(loadGuestPortalCopyV2('de')).rejects.toThrow(
      'No guest language pack exists for locale de',
    )
    await expect(loadGuestPortalCopyV2('es', 'guest-ui-es-v2')).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
  })

  it('has a loadable pack for every v2 pack the registry supports, and for every offered locale', async () => {
    for (const locale of GUEST_LOCALES) {
      const v2 = GUEST_LANGUAGE_PACKS[locale].supported.filter(
        (pack) => pack.generation === 2,
      )
      for (const pack of v2) {
        await expect(loadGuestPortalCopyV2(locale, pack.id)).resolves.toMatchObject({
          locale,
          version: pack.id,
        })
      }
    }
    for (const locale of OFFERED_GUEST_LOCALES) {
      await expect(loadGuestPortalCopyV2(locale)).resolves.toMatchObject({ locale })
    }
  })

  it('is the only place that imports a locale module, and only dynamically, so a request loads one pack', () => {
    const importers = sourceFiles(SRC)
      .filter((path) => /\.tsx?$/.test(path) && !/\.(?:test|stories)\.tsx?$/.test(path))
      .filter((path) =>
        /from\s+['"][^'"]*\/(?:en|bg)-v2['"]/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(SRC, path).split(sep).join('/'))
    expect(importers).toEqual([])
    const loader = readFileSync(
      join(import.meta.dirname, 'load-guest-copy-v2.ts'),
      'utf8',
    )
    expect(loader).toMatch(/import\('\.\/en-v2'\)/)
    expect(loader).toMatch(/import\('\.\/bg-v2'\)/)
  })
})
