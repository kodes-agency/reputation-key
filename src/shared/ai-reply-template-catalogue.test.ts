import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import rawCatalogue from './ai-reply-template-catalogue-v1.json'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
  REPLY_TEMPLATE_IDS,
  REPLY_TONES,
  parseAiReplyTemplateCatalogue,
  resolveAiReplyTemplate,
  validateAiReplyTemplateCatalogueBuild,
} from './ai-reply-template-catalogue'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { isAiReviewLanguageRuntimeAvailable } from './ai-review-language-catalogue'

const GROUPS = [
  'en-Latn',
  'es-Latn',
  'fr-Latn',
  'de-Latn',
  'pt-Latn',
  'it-Latn',
  'nl-Latn',
  'pl-Latn',
  'tr-Latn',
  'uk-Cyrl',
  'ru-Cyrl',
  'ar-Arab',
  'he-Hebr',
  'hi-Deva',
  'bn-Beng',
  'ta-Taml',
  'th-Thai',
  'vi-Latn',
  'id-Latn',
  'zh-Hans',
  'zh-Hant',
  'ja-Jpan',
  'ko-Kore',
  'bg-Cyrl',
] as const

const CLOSED_PLACEHOLDER = /\[(?:person|contact|address|financial|identifier|secret)\]/iu
const SLOT_OR_URL = /[{}]|https?:|www\.|\S+@\S+/iu
const CATALOGUE_DIGEST_GOLDEN =
  'ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f'
const CONTACT_OR_PROMISE_BY_GROUP: Readonly<Record<(typeof GROUPS)[number], RegExp>> = {
  'en-Latn': /\b(?:call|contact|email|phone|promise|guarantee|visit)\b/iu,
  'es-Latn': /\b(?:llame|contacte|correo|teléfono|prometemos|garantizamos|visite)\b/iu,
  'fr-Latn':
    /\b(?:appelez|contactez|courriel|téléphone|promettons|garantissons|visitez)\b/iu,
  'de-Latn':
    /\b(?:anrufen|kontaktieren|e-mail|telefon|versprechen|garantieren|besuchen)\b/iu,
  'pt-Latn': /\b(?:ligue|contate|e-mail|telefone|prometemos|garantimos|visite)\b/iu,
  'it-Latn': /\b(?:chiami|contatti|email|telefono|promettiamo|garantiamo|visiti)\b/iu,
  'nl-Latn': /\b(?:bellen|contact|e-mail|telefoon|beloven|garanderen|bezoeken)\b/iu,
  'pl-Latn': /\b(?:zadzwoń|kontakt|e-mail|telefon|obiecujemy|gwarantujemy|odwiedź)\b/iu,
  'tr-Latn':
    /\b(?:arayın|iletişim|e-posta|telefon|söz veriyoruz|garanti ediyoruz|ziyaret edin)\b/iu,
  'uk-Cyrl':
    /(?:зателефонуйте|зв’яжіться|електронна пошта|телефон|обіцяємо|гарантуємо|відвідайте)/iu,
  'ru-Cyrl':
    /(?:позвоните|свяжитесь|электронная почта|телефон|обещаем|гарантируем|посетите)/iu,
  'ar-Arab': /(?:اتصل|تواصل|بريد إلكتروني|هاتف|نعد|نضمن|زُر)/u,
  'he-Hebr': /(?:התקשר|צור קשר|דואר אלקטרוני|טלפון|מבטיחים|מתחייבים|בקר)/u,
  'hi-Deva': /(?:फ़ोन करें|संपर्क करें|ईमेल|टेलीफ़ोन|वादा करते|गारंटी देते|आइए)/u,
  'bn-Beng': /(?:ফোন করুন|যোগাযোগ করুন|ইমেইল|টেলিফোন|প্রতিশ্রুতি|নিশ্চয়তা দিচ্ছি|আসুন)/u,
  'ta-Taml':
    /(?:அழைக்கவும்|தொடர்பு கொள்ளவும்|மின்னஞ்சல்|தொலைபேசி|உறுதியளிக்கிறோம்|உத்தரவாதம்|வருக)/u,
  'th-Thai': /(?:โทรหา|ติดต่อ|อีเมล|โทรศัพท์|สัญญาว่า|รับประกัน|เยี่ยมชม)/u,
  'vi-Latn': /(?:gọi cho|liên hệ|email|điện thoại|hứa rằng|bảo đảm|ghé thăm)/iu,
  'id-Latn': /(?:hubungi|kontak|surel|telepon|berjanji|menjamin|kunjungi)/iu,
  'zh-Hans': /(?:联系|电话|电子邮件|承诺|保证|访问)/u,
  'zh-Hant': /(?:聯絡|電話|電子郵件|承諾|保證|造訪)/u,
  'ja-Jpan': /(?:連絡|電話|メール|約束|保証|訪問)/u,
  'ko-Kore': /(?:연락|전화|이메일|약속|보장|방문)/u,
  'bg-Cyrl':
    /(?:обадете се|свържете се|електронна поща|телефон|обещаваме|гарантираме|посетете)/iu,
}

function letterCount(value: string): number {
  return [...value].filter((scalar) => /\p{Letter}/u.test(scalar)).length
}

describe('gbp-reply-template-catalogue-v1', () => {
  it('contains the exact sorted 24 by 3 by 4 tuple product', () => {
    const catalogue = parseAiReplyTemplateCatalogue(rawCatalogue)
    const expected = GROUPS.flatMap((templateGroup) =>
      REPLY_TONES.flatMap((tone) =>
        REPLY_TEMPLATE_IDS.map((templateId) => ({ templateGroup, tone, templateId })),
      ),
    )

    expect(catalogue.version).toBe(AI_REPLY_TEMPLATE_CATALOGUE_VERSION)
    expect(catalogue.entries).toHaveLength(288)
    expect(
      catalogue.entries.map(({ templateGroup, tone, templateId }) => ({
        templateGroup,
        tone,
        templateId,
      })),
    ).toEqual(expected)
  })

  it('binds the canonical bytes to a stable domain-separated digest', () => {
    const parsed = parseAiReplyTemplateCatalogue(rawCatalogue)
    const independentlyComputed = createHash('sha256')
      .update('repkey-reply-template-catalogue-v1\0', 'utf8')
      .update(canonicalizeRfc8785(parsed), 'utf8')
      .digest('hex')

    expect(AI_REPLY_TEMPLATE_CATALOGUE_DIGEST).toBe(independentlyComputed)
    expect(AI_REPLY_TEMPLATE_CATALOGUE_DIGEST).toBe(CATALOGUE_DIGEST_GOLDEN)
  })

  it('contains only final NFKC-stable bounded text with at least 24 letters', () => {
    const catalogue = parseAiReplyTemplateCatalogue(rawCatalogue)
    for (const entry of catalogue.entries) {
      expect(entry.text.normalize('NFKC')).toBe(entry.text)
      expect(Buffer.byteLength(entry.text, 'utf8')).toBeGreaterThanOrEqual(1)
      expect(Buffer.byteLength(entry.text, 'utf8')).toBeLessThanOrEqual(16_384)
      expect([...entry.text].length).toBeGreaterThan(0)
      expect([...entry.text].length).toBeLessThanOrEqual(4_096)
      expect(letterCount(entry.text)).toBeGreaterThanOrEqual(24)
      expect(entry.text).not.toMatch(CLOSED_PLACEHOLDER)
      expect(entry.text).not.toMatch(SLOT_OR_URL)
      expect(entry.text).not.toMatch(CONTACT_OR_PROMISE_BY_GROUP[entry.templateGroup])
    }
  })

  it.runIf(isAiReviewLanguageRuntimeAvailable())(
    'passes the exact leakage, language, script, and orthography validators for every entry',
    async () => {
      await expect(validateAiReplyTemplateCatalogueBuild(rawCatalogue)).resolves.toEqual({
        version: AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
        digest: CATALOGUE_DIGEST_GOLDEN,
        entryCount: 288,
      })
    },
    20_000,
  )

  it('resolves by the complete group, tone, and template ID tuple only', () => {
    const professional = resolveAiReplyTemplate({
      templateGroup: 'es-Latn',
      tone: 'professional',
      templateId: 'recovery_service',
    })
    const casual = resolveAiReplyTemplate({
      templateGroup: 'es-Latn',
      tone: 'casual',
      templateId: 'recovery_service',
    })

    expect(professional).not.toBe(casual)
    expect(letterCount(professional)).toBeGreaterThanOrEqual(24)
    expect(letterCount(casual)).toBeGreaterThanOrEqual(24)
    expect(() =>
      resolveAiReplyTemplate({
        templateGroup: 'es-Latn',
        tone: 'casual',
        templateId: 'recovery_service',
        extra: true,
      } as never),
    ).toThrow(ZodError)
  })

  it('resolves all 12 bg-Cyrl tone and template ID tuples to distinct Bulgarian text', () => {
    const resolved = REPLY_TONES.flatMap((tone) =>
      REPLY_TEMPLATE_IDS.map((templateId) =>
        resolveAiReplyTemplate({ templateGroup: 'bg-Cyrl', tone, templateId }),
      ),
    )

    expect(resolved).toHaveLength(12)
    expect(new Set(resolved).size).toBe(12)
    for (const text of resolved) {
      expect(letterCount(text)).toBeGreaterThanOrEqual(24)
      expect(text).toMatch(/^[\p{Script=Cyrillic}\p{White_Space}\p{Punctuation}]+$/u)
      expect(text).not.toMatch(CONTACT_OR_PROMISE_BY_GROUP['bg-Cyrl'])
    }
  })

  it.each([
    ['unknown top-level key', { ...rawCatalogue, extra: true }, /Unrecognized key/],
    [
      'unknown entry key',
      {
        ...rawCatalogue,
        entries: [
          { ...rawCatalogue.entries[0], extra: true },
          ...rawCatalogue.entries.slice(1),
        ],
      },
      /Unrecognized key/,
    ],
    [
      'missing tuple',
      { ...rawCatalogue, entries: rawCatalogue.entries.slice(1) },
      /Too small/,
    ],
    [
      'duplicate tuple',
      { ...rawCatalogue, entries: [rawCatalogue.entries[0], ...rawCatalogue.entries] },
      /Too big/,
    ],
    [
      'reordered tuple',
      {
        ...rawCatalogue,
        entries: [
          rawCatalogue.entries[1],
          rawCatalogue.entries[0],
          ...rawCatalogue.entries.slice(2),
        ],
      },
      /missing, duplicated, or out of canonical order/,
    ],
    [
      'placeholder',
      {
        ...rawCatalogue,
        entries: [
          {
            ...rawCatalogue.entries[0],
            text: '[PERSON] this is deliberately long enough to pass the letter boundary safely',
          },
          ...rawCatalogue.entries.slice(1),
        ],
      },
      /failed output leakage validation/,
    ],
    [
      'slot',
      {
        ...rawCatalogue,
        entries: [
          {
            ...rawCatalogue.entries[0],
            text: 'Thank you {guest} for sharing a detailed and thoughtful review with us',
          },
          ...rawCatalogue.entries.slice(1),
        ],
      },
      /failed output leakage validation/,
    ],
    [
      'URL',
      {
        ...rawCatalogue,
        entries: [
          {
            ...rawCatalogue.entries[0],
            text: 'Thank you for the review. Visit https://example.test for more information',
          },
          ...rawCatalogue.entries.slice(1),
        ],
      },
      /failed output leakage validation/,
    ],
    [
      'short text',
      {
        ...rawCatalogue,
        entries: [
          { ...rawCatalogue.entries[0], text: 'Thank you' },
          ...rawCatalogue.entries.slice(1),
        ],
      },
      /at least 24 Unicode letters/,
    ],
    [
      'non-NFKC text',
      {
        ...rawCatalogue,
        entries: [
          {
            ...rawCatalogue.entries[0],
            text: 'Thank you for sharing this thoughtful cafe\u0301 review with our entire team',
          },
          ...rawCatalogue.entries.slice(1),
        ],
      },
      /NFKC-stable/,
    ],
  ])('rejects %s', (_label, value, expectedMessage) => {
    expect(() => parseAiReplyTemplateCatalogue(value)).toThrow(expectedMessage)
  })
})
