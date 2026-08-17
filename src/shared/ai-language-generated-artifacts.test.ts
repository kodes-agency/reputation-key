import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import catalogueManifest from './ai-review-language-catalogue-v1.manifest.json'
import scriptManifest from './ai-language-script-consistency-v1.manifest.json'
import replyManifest from './ai-reply-language-verifier-v1.manifest.json'
import zhManifest from './ai-zh-orthography-profile-v1.manifest.json'
import { LANGUAGE_CATALOGUE_DIGEST } from './ai-review-language-catalogue'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from './ai-language-script-consistency'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from './ai-reply-language-verifier'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from './ai-zh-orthography-verifier'
import {
  AI_REVIEW_LANGUAGE_CANONICAL_REGION_TABLE_DIGEST,
  AI_REVIEW_LANGUAGE_CANONICAL_REGIONS_V1,
} from './generated/ai-review-language-canonical-regions-v1'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'

const ROOT = resolve(import.meta.dirname, '../..')

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}
function uint32be(value: number): Buffer {
  const bytes = Buffer.allocUnsafe(4)
  bytes.writeUInt32BE(value)
  return bytes
}

function attestation(
  domain: string,
  members: readonly Readonly<{ path: string; bytes: Uint8Array }>[],
): string {
  const hash = createHash('sha256')
    .update(domain, 'utf8')
    .update(uint32be(members.length))
  for (const member of members) {
    const pathBytes = Buffer.from(member.path, 'utf8')
    hash.update(Buffer.from([1]))
    hash.update(uint32be(pathBytes.byteLength))
    hash.update(pathBytes)
    hash.update(uint32be(member.bytes.byteLength))
    hash.update(member.bytes)
  }
  return hash.digest('hex')
}

function profileWithoutAttestation(value: object): Record<string, unknown> {
  const profile = structuredClone(value) as Record<string, unknown>
  delete profile.wrapper
  delete profile.attestationDigest
  return profile
}

describe('AI language generated artifact attestations', () => {
  it('binds the CLD3 package closure, wrapper, and RFC 8785 vectors', () => {
    expect(
      sha256(readFileSync(resolve(ROOT, replyManifest.embeddedWasmRuntime.path))),
    ).toBe(replyManifest.embeddedWasmRuntime.sha256)
    expect(sha256(readFileSync(resolve(ROOT, replyManifest.wrapper.path)))).toBe(
      replyManifest.wrapper.sha256,
    )
    const vectors = JSON.parse(
      readFileSync(resolve(ROOT, replyManifest.vectors.path), 'utf8'),
    ) as unknown
    expect(sha256(canonicalizeRfc8785(vectors))).toBe(replyManifest.vectors.sha256)
    const profileBytes = Buffer.from(
      canonicalizeRfc8785(profileWithoutAttestation(replyManifest)),
      'utf8',
    )
    expect(
      attestation('repkey-reply-language-verifier-profile-v1\0', [
        {
          path: replyManifest.wrapper.path,
          bytes: readFileSync(resolve(ROOT, replyManifest.wrapper.path)),
        },
        {
          path: 'src/shared/ai-reply-language-verifier-v1.profile.json',
          bytes: profileBytes,
        },
      ]),
    ).toBe(AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST)
  })
  it('binds the review-language wrapper and ordered mapping vectors', () => {
    expect(sha256(readFileSync(resolve(ROOT, catalogueManifest.wrapper.path)))).toBe(
      catalogueManifest.wrapper.sha256,
    )
    const vectors = JSON.parse(
      readFileSync(resolve(ROOT, catalogueManifest.vectors.path), 'utf8'),
    ) as unknown
    expect(sha256(canonicalizeRfc8785(vectors))).toBe(catalogueManifest.vectors.sha256)
    const tagVectors = JSON.parse(
      readFileSync(resolve(ROOT, catalogueManifest.tagVectors.path), 'utf8'),
    ) as unknown
    expect(sha256(canonicalizeRfc8785(tagVectors))).toBe(
      catalogueManifest.tagVectors.sha256,
    )
    expect(catalogueManifest.canonicalRegions.digest).toBe(
      AI_REVIEW_LANGUAGE_CANONICAL_REGION_TABLE_DIGEST,
    )
    expect(AI_REVIEW_LANGUAGE_CANONICAL_REGIONS_V1).toEqual(
      [...AI_REVIEW_LANGUAGE_CANONICAL_REGIONS_V1].sort(),
    )
    for (const member of [
      catalogueManifest.canonicalRegions.generator,
      catalogueManifest.canonicalRegions.table,
    ]) {
      expect(sha256(readFileSync(resolve(ROOT, member.path)))).toBe(member.sha256)
    }
    expect(
      attestation('repkey-ai-review-language-catalogue-v1\0', [
        {
          path: catalogueManifest.wrapper.path,
          bytes: readFileSync(resolve(ROOT, catalogueManifest.wrapper.path)),
        },
        {
          path: catalogueManifest.vectors.path,
          bytes: Buffer.from(canonicalizeRfc8785(vectors), 'utf8'),
        },
        {
          path: catalogueManifest.tagVectors.path,
          bytes: Buffer.from(canonicalizeRfc8785(tagVectors), 'utf8'),
        },
        {
          path: catalogueManifest.canonicalRegions.generator.path,
          bytes: readFileSync(
            resolve(ROOT, catalogueManifest.canonicalRegions.generator.path),
          ),
        },
        {
          path: catalogueManifest.canonicalRegions.table.path,
          bytes: readFileSync(
            resolve(ROOT, catalogueManifest.canonicalRegions.table.path),
          ),
        },
      ]),
    ).toBe(LANGUAGE_CATALOGUE_DIGEST)
  })

  it('binds the Script_Extensions generator, wrapper, table, and vectors', () => {
    for (const member of [
      scriptManifest.generator,
      scriptManifest.wrapper,
      scriptManifest.table,
    ]) {
      expect(sha256(readFileSync(resolve(ROOT, member.path)))).toBe(member.sha256)
    }
    const vectors = JSON.parse(
      readFileSync(resolve(ROOT, scriptManifest.vectors.path), 'utf8'),
    ) as unknown
    expect(sha256(canonicalizeRfc8785(vectors))).toBe(scriptManifest.vectors.sha256)
    expect(
      attestation('repkey-language-script-consistency-profile-v1\0', [
        {
          path: scriptManifest.wrapper.path,
          bytes: readFileSync(resolve(ROOT, scriptManifest.wrapper.path)),
        },
        {
          path: scriptManifest.vectors.path,
          bytes: Buffer.from(canonicalizeRfc8785(vectors), 'utf8'),
        },
        {
          path: scriptManifest.generator.path,
          bytes: readFileSync(resolve(ROOT, scriptManifest.generator.path)),
        },
        {
          path: scriptManifest.table.path,
          bytes: readFileSync(resolve(ROOT, scriptManifest.table.path)),
        },
      ]),
    ).toBe(AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST)
  })

  it('binds every imported OpenCC closure member, generator, and generated table', () => {
    for (const member of zhManifest.importedMembers) {
      expect(
        sha256(readFileSync(resolve(ROOT, 'node_modules/opencc-js', member.path))),
      ).toBe(member.sha256)
    }
    expect(sha256(readFileSync(resolve(ROOT, zhManifest.wrapper.path)))).toBe(
      zhManifest.wrapper.sha256,
    )
    const vectors = JSON.parse(
      readFileSync(resolve(ROOT, zhManifest.vectors.path), 'utf8'),
    ) as unknown
    expect(sha256(canonicalizeRfc8785(vectors))).toBe(zhManifest.vectors.sha256)
    expect(sha256(readFileSync(resolve(ROOT, zhManifest.generator.path)))).toBe(
      zhManifest.generator.sha256,
    )
    expect(sha256(readFileSync(resolve(ROOT, zhManifest.table.path)))).toBe(
      zhManifest.table.sha256,
    )
    const profileBytes = Buffer.from(
      canonicalizeRfc8785(profileWithoutAttestation(zhManifest)),
      'utf8',
    )
    expect(
      attestation('repkey-zh-orthography-verifier-profile-v1\0', [
        {
          path: zhManifest.wrapper.path,
          bytes: readFileSync(resolve(ROOT, zhManifest.wrapper.path)),
        },
        {
          path: 'src/shared/ai-zh-orthography-profile-v1.profile.json',
          bytes: profileBytes,
        },
      ]),
    ).toBe(AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST)
  })

  it('changes profile evidence after any one-bit manifest mutation', () => {
    const profile = profileWithoutAttestation(replyManifest)
    profile.constants = {
      ...(profile.constants as Record<string, unknown>),
      minimumLetters: 25,
    }
    expect(
      attestation('repkey-reply-language-verifier-profile-v1\0', [
        {
          path: replyManifest.wrapper.path,
          bytes: readFileSync(resolve(ROOT, replyManifest.wrapper.path)),
        },
        {
          path: 'src/shared/ai-reply-language-verifier-v1.profile.json',
          bytes: Buffer.from(canonicalizeRfc8785(profile), 'utf8'),
        },
      ]),
    ).not.toBe(AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST)
  })
})
