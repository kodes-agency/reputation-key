import { describe, expect, it } from 'vitest'
import {
  AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
  hasProhibitedReplyCommitment,
} from './ai-personalized-reply-contract'

describe('compensation, promise and admission filter', () => {
  it.each([
    'Any extra costs have been refunded.',
    'Refunds will be issued this week.',
    'We are refunding the difference.',
    'We have reimbursed you in full.',
    'We offer reimbursement for the taxi.',
    'You will get two free nights next time.',
    'There will be free meals for everyone.',
    'We will give you free upgrades on arrival.',
    'We are compensating you for the noise.',
    'That is guaranteed from now on.',
    'We promised to look into it.',
    'Our team was at fault here.',
    'We will send your money back this week.',
    'A voucher for your next visit is on its way.',
    'We would like to offer you a discount.',
    'Your next dinner is on the house.',
    'We can arrange a free room change.',
    'The first drink is a free welcome one on us.',
    'We take full responsibility for this.',
    'The hotel accepts responsibility for the noise.',
  ])('flags the English reply sentence "%s"', (sentence) => {
    expect(hasProhibitedReplyCommitment(sentence)).toBe(true)
  })

  it.each([
    'Ще ви възстановим сумата още днес.',
    'Ще ви възстановим парите за престоя.',
    'Ще Ви върнем парите утре.',
    'Ще ви върнем сумата по сметката.',
    'Предлагаме ви безплатна нощувка.',
    'Предлагаме безплатен престой при следващо посещение.',
    'Получавате безплатни нощувки.',
    'Получавате безплатно хранене.',
    'Предлагаме безплатен ъпгрейд на стаята.',
    'Признаваме вината си за случилото се.',
    'Признаваме, че това е наша вина.',
    'Започваме процедура по възстановяване на сумата.',
    'Ще ви компенсираме за неудобството.',
    'Гарантираме ви пълна тишина.',
    'Управителят гарантира, че това няма да се повтори.',
    'Обещаваме да се подобрим.',
    'Давам ви обещание за промяна.',
    'Ще ви изплатим обезщетение.',
    'Ще Ви възстановим заплатената сума.',
    'Сумата ще ви бъде възстановена.',
    'Ще ви върнем платената сума утре.',
    'Ще възстановим цената за престоя.',
    'Признаваме грешката си.',
    'Поемаме отговорност за случилото се.',
    'Предлагаме ви ваучер за следващия престой.',
    'Ще ви направим отстъпка при следващо посещение.',
  ])('flags the Bulgarian reply sentence "%s"', (sentence) => {
    expect(hasProhibitedReplyCommitment(sentence)).toBe(true)
  })

  it.each([
    'We are glad the free breakfast was enjoyable.',
    'The staff will pass your kind words on to the whole team.',
    'We hope to welcome you again soon.',
    'You can count on us to keep the room as quiet as you found it.',
    'We are responsible for the garden, and your kind words mean a lot.',
    'Thank you for booking directly with us.',
  ])('passes the ordinary English reply sentence "%s"', (sentence) => {
    expect(hasProhibitedReplyCommitment(sentence)).toBe(false)
  })

  it.each([
    'Благодарим ви за добрите думи към екипа.',
    'Ще предадем отзива ви на колегите от рецепцията.',
    'Надяваме се скоро отново да ви посрещнем.',
    'Закуската ни е гордост и се радваме, че ви хареса.',
    'Ще се радваме да се върнете при нас и да ви посрещнем отново.',
    'Благодарим, че оценихте цената и качеството на услугата.',
    'Радваме се, че се чувствахте добре и ще предадем думите ви на екипа.',
  ])('passes the ordinary Bulgarian reply sentence "%s"', (sentence) => {
    expect(hasProhibitedReplyCommitment(sentence)).toBe(false)
  })

  it('records the patterns in the profile digest, not only how many there are', () => {
    // The first generation digested `prohibitedPatternCount: 3`, so repairing the
    // patterns changed neither the profile nor its digest.
    expect(AI_PERSONALIZED_REPLY_PROFILE_DIGEST).not.toBe(
      'e96cfa2f6e89fb88201bc4e37779ee53e393ee1bba1d422cc030d67c91726869',
    )
  })
})
