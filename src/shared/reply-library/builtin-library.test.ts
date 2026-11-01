import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import rawLibrary from './builtin-library-v1.json'
import {
  BUILTIN_REPLY_LIBRARY_DIGEST,
  BUILTIN_REPLY_LIBRARY_VERSION,
} from './builtin-library'
import { parseBuiltinReplyLibrary } from './builtin-library.schema'
import { canonicalizeRfc8785 } from '../canonical-json'
import { checkReplyText } from './reply-checks'

const DIGEST_GOLDEN = 'bec4a34039db5adc43f194a334ce7e9c1e1d047a55e46eaef2ce9a3109f6afce'

describe('built-in reply library v1', () => {
  it('binds the canonical owner-approved library to a stable digest', () => {
    const parsed = parseBuiltinReplyLibrary(rawLibrary)
    const digest = createHash('sha256')
      .update('repkey-builtin-reply-library\0', 'utf8')
      .update(canonicalizeRfc8785(parsed), 'utf8')
      .digest('hex')

    expect(parsed.version).toBe(BUILTIN_REPLY_LIBRARY_VERSION)
    expect(BUILTIN_REPLY_LIBRARY_DIGEST).toBe(digest)
    expect(BUILTIN_REPLY_LIBRARY_DIGEST).toBe(DIGEST_GOLDEN)
  })

  it('contains exactly nine essentials and safe wording variables', () => {
    const library = parseBuiltinReplyLibrary(rawLibrary)
    expect(library.templates.filter((template) => template.essential)).toHaveLength(9)

    for (const template of library.templates) {
      for (const wording of template.wordings) {
        for (const [languageGroup, text] of Object.entries(wording.text)) {
          expect(
            checkReplyText({
              text,
              kind: 'template_body',
              rating: template.starsMin,
              reviewKind: template.reviewKind,
              languageGroup,
              privacyMode: false,
              emojiAllowed: false,
            }).blocks,
            `${template.key}/${wording.key}/${languageGroup}`,
          ).toEqual([])
          if (languageGroup === 'es-Latn') expect(text).not.toContain('{thing}')
          if (text.includes('{staff_name}'))
            expect(template.starsMin).toBeGreaterThanOrEqual(4)
        }
      }
    }
  })
})
