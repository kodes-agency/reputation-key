import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GUEST_LANGUAGE_PACKS,
  GUEST_LOCALES,
  OFFERED_GUEST_LOCALES,
} from '#/shared/domain/guest-locale'
import { loadGuestPortalCopy } from './load-guest-copy'

const SRC = join(import.meta.dirname, '..', '..', '..', '..', '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? sourceFiles(full) : [full]
  })
}

describe('loadGuestPortalCopy', () => {
  it('returns the one pack that was asked for', async () => {
    const en = await loadGuestPortalCopy('en')
    const bg = await loadGuestPortalCopy('bg')
    expect(en).toMatchObject({ locale: 'en', version: 'guest-ui-en-v2' })
    expect(bg).toMatchObject({ locale: 'bg', version: 'guest-ui-bg-v2' })
    expect(Object.keys(en).sort()).toEqual([
      'copy',
      'locale',
      'plurals',
      'version',
      'zoneNames',
    ])
  })

  it('loads the pinned version when the snapshot names one', async () => {
    const pack = await loadGuestPortalCopy('bg', 'guest-ui-bg-v2')
    expect(pack.copy.ratingSend).toBe('Изпрати')
  })

  it('throws when the pinned pack belongs to another locale', async () => {
    await expect(loadGuestPortalCopy('bg', 'guest-ui-en-v2')).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
  })

  it('throws for an explicit null pin instead of loading the current pack', async () => {
    await expect(loadGuestPortalCopy('en', null)).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
  })

  it('throws for a v1 pack, an unknown version and a non-string', async () => {
    await expect(loadGuestPortalCopy('en', 'guest-ui-en-v1')).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
    await expect(loadGuestPortalCopy('en', 'guest-ui-en-v9')).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
    await expect(loadGuestPortalCopy('en', 2)).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
  })

  it('loads the es, it, fr and de packs, each at its own pinned version', async () => {
    for (const locale of ['es', 'it', 'fr', 'de'] as const) {
      const pack = await loadGuestPortalCopy(locale, `guest-ui-${locale}-v2`)
      expect(pack).toMatchObject({ locale, version: `guest-ui-${locale}-v2` })
      await expect(loadGuestPortalCopy(locale)).resolves.toBe(pack)
    }
  })

  it('throws when a pinned pack belongs to another new locale or to generation 1', async () => {
    await expect(loadGuestPortalCopy('de', 'guest-ui-fr-v2')).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
    await expect(loadGuestPortalCopy('es', 'guest-ui-es-v1')).rejects.toThrow(
      'Guest locale and immutable language pack do not match',
    )
  })

  it('has a loadable pack for every template pack the registry supports, and for every offered locale', async () => {
    for (const locale of GUEST_LOCALES) {
      const supported = GUEST_LANGUAGE_PACKS[locale].supported.filter(
        (pack) => pack.generation === 2,
      )
      for (const pack of supported) {
        await expect(loadGuestPortalCopy(locale, pack.id)).resolves.toMatchObject({
          locale,
          version: pack.id,
        })
      }
    }
    for (const locale of OFFERED_GUEST_LOCALES) {
      await expect(loadGuestPortalCopy(locale)).resolves.toMatchObject({ locale })
    }
  })

  it('is the only place that imports a locale module, and only dynamically, so a request loads one pack', () => {
    const importers = sourceFiles(SRC)
      // Tests, stories and story fixtures are not production code: a story may
      // import a pack directly to render a real language.
      .filter(
        (path) =>
          /\.tsx?$/.test(path) &&
          !/\.(?:test|stories)\.tsx?$/.test(path) &&
          !/[\\/]__fixtures__[\\/]/.test(path),
      )
      .filter((path) =>
        /from\s+['"][^'"]*\/(?:en|bg|es|it|fr|de)['"]/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(SRC, path).split(sep).join('/'))
    expect(importers).toEqual([])
    const loader = readFileSync(join(import.meta.dirname, 'load-guest-copy.ts'), 'utf8')
    expect(loader).toMatch(/import\('\.\/en'\)/)
    for (const locale of GUEST_LOCALES) {
      expect(loader).toContain(`import('./${locale}')`)
    }
  })
})
