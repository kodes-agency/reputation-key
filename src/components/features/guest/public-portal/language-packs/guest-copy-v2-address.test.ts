import { describe, expect, it } from 'vitest'
import { deV2 } from './de-v2'
import { esV2 } from './es-v2'
import { frV2 } from './fr-v2'
import { itV2 } from './it-v2'
import type { GuestPortalCopyV2 } from './guest-copy-v2'

// The form of address is fixed per language so a pack never mixes registers:
// German Sie (round 4 board G10), French vous, Spanish usted, Italian Lei.
// What is pinned: no informal pronoun or possessive, and none of the informal
// imperatives a button or sentence would slip into (`Elige`, `Choisis`,
// `Rimuovila`). A word the lists do not know can still get through; the native
// check deferred by owner decision 5 is what would catch it. Verbs that are
// also the third person (`ouvre`, `abre`, `comparte`: "opens", "is shared") are
// left out of the lists on purpose, since the hints use them.
//
// The boundaries are Unicode-aware: a plain \b treats an accented letter as a
// non-word character, so `tú\b` would never match `tú `.
const word = (alternatives: string) =>
  new RegExp(`(?<![\\p{L}])(?:${alternatives})(?![\\p{L}])`, 'iu')

describe('the form of address', () => {
  const text = (pack: GuestPortalCopyV2) =>
    [
      ...Object.values(pack.copy),
      ...Object.values(pack.plurals).flatMap((forms) => Object.values(forms)),
    ].join('\n')

  it('addresses the guest as Sie in German and never as du', () => {
    expect(deV2.copy.ratingTitle).toBe('Wie hat es Ihnen gefallen?')
    expect(text(deV2)).not.toMatch(word('du|dich|dir|dein\\p{L}*|euch|euer\\p{L}*'))
    expect(text(deV2)).not.toMatch(
      /(?<![\p{L}])(?:wähle|schreibe|versuche|teile|entferne|lösche|beginne|gib|sende|speichere)(?![\p{L}])/u,
    )
    expect(text(deV2)).toMatch(/\bIhre?[mnrs]?\b/)
  })

  it('addresses the guest as vous in French and never as tu', () => {
    expect(text(frV2)).not.toMatch(word('tu|toi|ton|ta|tes|te'))
    expect(text(frV2)).not.toMatch(
      word(
        'choisis|écris|réessaie|essaie|partage|modifie|supprime|recommence|continue|ferme|ajoute|envoie|enregistre|raconte',
      ),
    )
    expect(text(frV2)).toMatch(/\bvotre\b/i)
  })

  it('addresses the guest as usted in Spanish and never as tú', () => {
    expect(text(esV2)).not.toMatch(word('tú|tu|tus|ti|contigo'))
    expect(text(esV2)).not.toMatch(
      word(
        'elige|escribe|inténtalo|intenta|vuelve|cierra|borra|elimina|continúa|revisa|añade|envía|guarda|cambia|empieza',
      ),
    )
    expect(text(esV2)).toMatch(/\bsu\b/i)
  })

  it('addresses the guest as Lei in Italian and never as tu', () => {
    expect(text(itV2)).not.toMatch(word('tuo|tua|tuoi|tue|ti|te'))
    // Buttons such as `Invia` and `Rimuovi` are the neutral form every Italian
    // interface uses; what is ruled out is a tu imperative with a pronoun on
    // the end, or one that has a Lei form of its own.
    expect(text(itV2)).not.toMatch(
      word(
        'rimuovila|rimuovile|conservala|conservale|ricomincia|scrivi|riprova|scegli|aggiungi|condividi|apri',
      ),
    )
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
