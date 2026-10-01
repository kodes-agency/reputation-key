// Portal context — sharp (libvips) behind the image processor port.
//
// Uploads are hostile input, so three things hold here that the policy cannot
// see from outside:
//
//   1. Only the three decoders the policy accepts are enabled, process-wide.
//      libvips ships loaders for SVG, PDF, GIF, TIFF and more; each is blocked,
//      so a file that lies about its type reaches no parser we did not choose.
//   2. The decoder is told how many pixels it may hold and fails on any
//      warning, so a decompression bomb or a damaged file is refused rather
//      than half-read.
//   3. At most MAX_CONCURRENT_DECODES run at once. A decode can hold about 160 MB;
//      without a bound a burst of uploads is a memory exhaustion.
//
// Output carries nothing from the input but pixels: sharp drops EXIF, XMP, the
// colour profile and every trailing byte unless asked to keep them, and this
// adapter never asks.

import type SharpFactory from 'sharp'
import { createConcurrencyGate } from './concurrency-gate'
import type { ImageProcessorPort } from '../../application/ports/image-processor.port'
import {
  PORTAL_IMAGE_LIMITS,
  portalImageRejection,
  type EncodedImage,
  type ImageFacts,
  type PortalImageRejectionReason,
  type ReencodePlan,
} from '../../domain/portal-image-policy'

const MAX_CONCURRENT_DECODES = 2

/** The only libvips loaders left enabled. */
const TRUSTED_LOADERS = [
  'VipsForeignLoadJpegBuffer',
  'VipsForeignLoadPngBuffer',
  'VipsForeignLoadWebpBuffer',
  'VipsForeignLoadJpeg',
  'VipsForeignLoadPng',
  'VipsForeignLoadWebp',
] as const

type Sharp = typeof SharpFactory

let configured: Promise<Sharp> | null = null

/** Loads sharp once and narrows it to the trusted loaders. Lazy, so a process that never decodes never loads libvips. */
function loadSharp(): Promise<Sharp> {
  configured ??= import('sharp').then((module) => {
    const sharp = module.default
    sharp.block({ operation: ['VipsForeignLoad'] })
    sharp.unblock({ operation: [...TRUSTED_LOADERS] })
    // Nothing is decoded twice, so the operation cache only holds memory.
    sharp.cache(false)
    return sharp
  })
  return configured
}

const refusalFor = (error: unknown): PortalImageRejectionReason =>
  error instanceof Error && /pixel limit|exceeds pixel/i.test(error.message)
    ? 'too_many_pixels'
    : 'undecodable'

const decoderOptions = () =>
  ({
    failOn: 'warning',
    limitInputPixels: PORTAL_IMAGE_LIMITS.maxInputPixels,
    sequentialRead: true,
    animated: false,
  }) as const

export const createSharpImageProcessor = (): ImageProcessorPort => {
  const gate = createConcurrencyGate(MAX_CONCURRENT_DECODES)

  return {
    inspect: async (bytes) => {
      const sharp = await loadSharp()
      try {
        const metadata = await sharp(Buffer.from(bytes), decoderOptions()).metadata()
        const { format, width, height } = metadata
        if (!format || !width || !height) throw new Error('no header')
        const facts: ImageFacts = {
          format,
          width,
          height,
          pages: metadata.pages ?? 1,
          orientation: metadata.orientation ?? null,
          hasAlpha: metadata.hasAlpha ?? false,
        }
        return facts
      } catch (error) {
        throw portalImageRejection(refusalFor(error))
      }
    },

    reencode: (bytes, plan: ReencodePlan) =>
      gate(async (): Promise<EncodedImage> => {
        const sharp = await loadSharp()
        try {
          let pipeline = sharp(Buffer.from(bytes), decoderOptions())
            // Bake the EXIF orientation into the pixels; the tag itself is dropped.
            .rotate()
            .resize({ width: plan.width, height: plan.height, fit: 'fill' })
          if (!plan.keepAlpha) pipeline = pipeline.flatten({ background: '#ffffff' })
          const { data, info } = await pipeline
            .webp({ quality: plan.quality, alphaQuality: 100, smartSubsample: true })
            .toBuffer({ resolveWithObject: true })
          return { bytes: new Uint8Array(data), width: info.width, height: info.height }
        } catch (error) {
          throw portalImageRejection(refusalFor(error))
        }
      }),
  }
}
