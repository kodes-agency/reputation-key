import { describe, expect, it } from 'vitest'
import { isAiIssueLabel, issueLabelReproducesSource } from './ai-issue-label'

describe('AI issue label rule', () => {
  it('accepts bounded lowercase category phrases', () => {
    expect(isAiIssueLabel('slow front desk response')).toBe(true)
    expect(isAiIssueLabel('wifi')).toBe(true)
  })

  it.each([
    '',
    'five words are one too many',
    'Dirty rooms',
    'dirty-room',
    'dirty  room',
    'a'.repeat(41),
  ])('rejects %j', (value) => {
    expect(isAiIssueLabel(value)).toBe(false)
  })
})

describe('issue label source reproduction', () => {
  const review = 'The room was fine but the worst hotel ever experience was checkout.'

  it('refuses a multi-word label quoted from the review', () => {
    expect(issueLabelReproducesSource('worst hotel ever', review)).toBe(true)
  })

  it('allows a single word that necessarily appears in the source', () => {
    // `cleanliness` occurs in any review about cleanliness. Refusing it would
    // discard the discovery signal the open label exists to provide.
    expect(issueLabelReproducesSource('checkout', review)).toBe(false)
  })

  it('allows a multi-word category the guest did not phrase that way', () => {
    expect(issueLabelReproducesSource('checkout delay', review)).toBe(false)
  })

  it('matches on token boundaries, not incidental substrings', () => {
    expect(issueLabelReproducesSource('om was', review)).toBe(false)
  })

  it('folds case, width and whitespace before comparing', () => {
    expect(issueLabelReproducesSource('worst hotel', 'WORST   HOTEL stay')).toBe(true)
  })

  // A label holds letters and single spaces only, so a copied phrase can never
  // carry the punctuation that touched it in the review. Guests end sentences
  // and clauses with exactly the short phrases a label is made of.
  it.each([
    ['rude staff', 'Dirty rooms, rude staff. Worst hotel ever!'],
    ['worst hotel ever', 'Dirty rooms, rude staff. Worst hotel ever!'],
    ['dirty rooms', 'Dirty rooms, rude staff. Worst hotel ever!'],
    ['slow service', 'We left because of the (slow service).'],
    ['cold food', 'Two words: "cold food"'],
    ['long wait', 'The check-in?! Long wait; never again'],
    ['noisy room', 'noisy room'],
    ['broken shower', 'Bad stay—broken shower… and no apology'],
    ['check in', 'Check-in took an hour.'],
  ])('refuses %j quoted next to punctuation in %j', (label, source) => {
    expect(issueLabelReproducesSource(label, source)).toBe(true)
  })

  it.each([
    ['staff didnt care', "The staff didn't care at all."],
    ['staff didnt care', 'The staff didn’t care at all.'],
    ['habitacion sucia', 'Una habitación sucia y fría.'],
  ])('refuses %j copied from %j with the marks a label cannot hold', (label, source) => {
    expect(issueLabelReproducesSource(label, source)).toBe(true)
  })

  // An apostrophe inside a word has two readings and a copy can take either.
  // English drops it (`didnt`, above). French and Italian elide an article
  // onto the next word, so the copied phrase starts right after the mark.
  it.each([
    ['accueil froid', "Personnel désagréable, l'accueil froid."],
    ['accueil froid', 'Personnel désagréable, l\u2019accueil froid.'],
    ['hotel sale', "Nous avons trouvé l'hôtel sale."],
    ['eau chaude', "Pas d'eau chaude le matin."],
    ['aria condizionata', "L'aria condizionata non funzionava."],
    ['accueil froid', 'Un accueil froid.'],
  ])('refuses %j copied from right after an elided article in %j', (label, source) => {
    expect(issueLabelReproducesSource(label, source)).toBe(true)
  })

  // One phrase can need both readings: a break at `l'`, the mark dropped in
  // `n'était`.
  it.each([
    ['eau netait pas chaude', "L'eau n'était pas chaude."],
    ['hotel netait pas propre', 'L\u2019hôtel n\u2019était pas propre du tout.'],
  ])('refuses %j, which reads each apostrophe of %j its own way', (label, source) => {
    expect(issueLabelReproducesSource(label, source)).toBe(true)
  })

  // What guests type for an apostrophe: the grave and acute accents, the left
  // quotation mark, the prime and the modifier prime.
  it.each([
    ['U+0060', 'The staff didn`t care at all.'],
    ['U+00B4', 'The staff didn\u00b4t care at all.'],
    ['U+2018', 'The staff didn\u2018t care at all.'],
    ['U+2032', 'The staff didn\u2032t care at all.'],
    ['U+02B9', 'The staff didn\u02b9t care at all.'],
    // As the analysis hands it over: review text is NFKC, which spells U+00B4
    // as a space carrying a combining acute.
    ['U+00B4 in NFKC', 'The staff didn\u00b4t care at all.'.normalize('NFKC')],
  ])('reads %s as an apostrophe inside a word', (_mark, source) => {
    expect(issueLabelReproducesSource('staff didnt care', source)).toBe(true)
  })

  it('reads an acute accent typed after an accented letter as an apostrophe', () => {
    expect(
      issueLabelReproducesSource('cafes staff', 'The café\u00b4s staff were kind.'),
    ).toBe(true)
  })

  it('reads a look-alike apostrophe as a word break as well', () => {
    expect(issueLabelReproducesSource('accueil froid', 'Bref, l`accueil froid.')).toBe(
      true,
    )
  })

  // The hyphen inside a word is the same mark in a compound: a label can only
  // spell `Wi-Fi` as `wifi` or as `wi fi`.
  it.each([
    ['wifi was slow', 'The Wi-Fi was slow all week.'],
    ['wi fi was slow', 'The Wi-Fi was slow all week.'],
    ['checkin took an hour', 'Check-in took an hour.'],
    ['checkin took an hour', 'Check\u2010in took an hour.'],
    ['petitdejeuner froid', 'Un petit-déjeuner froid.'],
  ])('refuses %j copied from the compound in %j', (label, source) => {
    expect(issueLabelReproducesSource(label, source)).toBe(true)
  })

  // A soft hyphen is invisible in the review and splits the word it sits in.
  it.each(['rude staff', 'ru de staff'])(
    'refuses %j copied from a word that holds a soft hyphen',
    (label) => {
      expect(issueLabelReproducesSource(label, 'So ru\u00adde staff.')).toBe(true)
    },
  )

  it.each([
    // Still a category: one word, wherever the guest's apostrophe put it.
    ['accueil', "Personnel désagréable, l'accueil froid."],
    // The words are the guest's, the phrase is not.
    ['service lent', "Le service n'était pas lent."],
    ['accueil chaleureux', "L'accueil, pas vraiment chaleureux."],
    // A quotation mark is not an apostrophe inside a word.
    ['staff rude', "The staff said 'rude' things."],
    // Only a mark inside one word joins its halves.
    ['roomservice slow', 'The room - service slow as ever.'],
  ])('still allows %j for %j', (label, source) => {
    expect(issueLabelReproducesSource(label, source)).toBe(false)
  })

  it('still allows a single word that sits next to punctuation', () => {
    expect(issueLabelReproducesSource('checkout', 'Slow checkout. Nice pool!')).toBe(
      false,
    )
  })

  it('still allows a category whose words the guest wrote apart', () => {
    expect(
      issueLabelReproducesSource('rude staff', 'Rude, loud and unhelpful staff.'),
    ).toBe(false)
  })

  it('does not join the halves of a word that punctuation splits', () => {
    expect(issueLabelReproducesSource('heck in', 'Check-in took an hour.')).toBe(false)
  })
})
