import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import manifest from '../src/shared/ai-reply-language-verifier-v1.manifest.json'
import { createCld3ReplyLanguageDetector } from '../src/shared/ai-reply-language-verifier'

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(
    readFileSync(resolve('node_modules/cld3-asm/package.json'), 'utf8'),
  ) as { name?: unknown; version?: unknown }
  if (
    packageJson.name !== manifest.package.name ||
    packageJson.version !== manifest.package.version
  ) {
    throw new Error('cld3-asm package identity drift')
  }

  const assetBytes = readFileSync(resolve(manifest.embeddedWasmRuntime.path))
  if (sha256(assetBytes) !== manifest.embeddedWasmRuntime.sha256) {
    throw new Error('cld3-asm embedded runtime asset drift')
  }

  const detector = await createCld3ReplyLanguageDetector()
  try {
    const detection = detector.detect(
      'This is a deterministic English language detector runtime asset verification sentence.',
    )
    if (
      detection.language !== 'en' ||
      !Number.isFinite(detection.probability) ||
      typeof detection.reliable !== 'boolean'
    ) {
      throw new Error(
        'cld3-asm runtime detector did not return the expected English result',
      )
    }
  } finally {
    detector.dispose()
    assetBytes.fill(0)
  }
}

void main()
