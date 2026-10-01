import { describe, expect, it } from 'vitest'
import { deV2 } from './de-v2'
import { esV2 } from './es-v2'
import { frV2 } from './fr-v2'
import { itV2 } from './it-v2'
import type { GuestPortalCopyV2 } from './guest-copy-v2'

// The form of address is fixed per language so a pack never mixes registers:
// German Sie (round 4 board G10), French vous, Spanish usted, Italian Lei.
describe('the form of address', () => {
  const text = (pack: GuestPortalCopyV2) =>
    [
      ...Object.values(pack.copy),
      ...Object.values(pack.plurals).flatMap((forms) => Object.values(forms)),
    ].join('\n')

  it('addresses the guest as Sie in German and never as du', () => {
    expect(deV2.copy.ratingTitle).toBe('Wie hat es Ihnen gefallen?')
    expect(text(deV2)).not.toMatch(/\b(du|dich|dir|dein\w*|euch|euer\w*|ihr)\b/)
    expect(text(deV2)).toMatch(/\bIhre?[mnrs]?\b/)
  })

  it('addresses the guest as vous in French and never as tu', () => {
    expect(text(frV2)).not.toMatch(/\b(tu|toi|ton|ta|tes|te)\b/i)
    expect(text(frV2)).toMatch(/\bvotre\b/i)
  })

  it('addresses the guest as usted in Spanish and never as tú', () => {
    expect(text(esV2)).not.toMatch(/\b(tú|tu|tus|ti|contigo)\b/i)
    expect(text(esV2)).toMatch(/\bsu\b/i)
  })

  it('addresses the guest as Lei in Italian and never as tu', () => {
    expect(text(itV2)).not.toMatch(/\b(tuo|tua|tuoi|tue|ti|te)\b/i)
    expect(text(itV2)).toMatch(/\bsua\b/i)
  })

  it('uses the owner’s German glossary and the long words of board G10 as written', () => {
    expect(deV2.copy).toMatchObject({
      languageSheetHint:
        'Die Seite öffnet sich in der Sprache Ihres Telefons, wenn verfügbar.',
      ratingThanks: 'Vielen Dank.',
      googleTitle: 'Teilen Sie Ihre Erfahrung auf Google',
      googleAction: 'Weiter zu Google',
      noteOfferTitle: 'Private Nachricht an das Team',
      ratingWord1: 'Schlecht',
      ratingWord2: 'Mäßig',
      ratingWord3: 'Gut',
      ratingWord4: 'Sehr gut',
      ratingWord5: 'Ausgezeichnet',
      ratingSend: 'Privat senden',
      ratingPrivacyLine: 'Wird vertraulich an {name} gesendet.',
      privacyNoticeLink: 'Datenschutzhinweis',
      visitNoticeAcknowledge: 'Verstanden',
      languageChipLabel: 'Sprache',
      linktreeDefaultTitle: 'Nützliche Links',
    })
    expect(deV2.copy.visitNotice).toBe(
      'Diese Seite zählt Besuche für {name}. Keine Werbung, keine Tracker von Dritten.',
    )
  })
})
