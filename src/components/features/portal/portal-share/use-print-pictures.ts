// The pictures of a Immersive face as the Share tab's preview reads them
// (design spec §4 and §6): the photo decoded small, 240 px wide for the
// ground and the kicker and up to 960 px wide for what lies under each word, as
// the PDF decodes it; and the logo, for its proportions and how light its ink
// is. The browser decodes with a canvas; the pictures are same-origin media
// paths, so the canvas can be read.

import { useEffect, useState } from 'react'
import {
  PRINT_LOGO_TONE_SIZE_PX,
  printMedianInkLuminance,
} from '#/shared/domain/portal-print-brand'
import type { PrintPhotoPixels } from '#/shared/domain/portal-print-photo'
import {
  PRINT_DETAIL_WIDTH_PX,
  PRINT_SAMPLE_WIDTH_PX,
  type PrintPhotoSample,
} from '#/shared/domain/portal-print-photo-sample'

export type PreviewPhoto = Readonly<{
  sample: PrintPhotoSample
  detail: PrintPhotoSample
  pixels: PrintPhotoPixels
}>

export type PreviewLogo = Readonly<{
  /** The picture's width over its height. */
  aspect: number
  medianInkLuminance: number | null
}>

type Decoded = Readonly<{
  image: HTMLImageElement
  data: Uint8ClampedArray
  width: number
  height: number
}>

async function decode(
  url: string,
  size: (image: HTMLImageElement) => readonly [number, number],
): Promise<Decoded> {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await image.decode()
  const [width, height] = size(image)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('This browser cannot read a picture')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, width, height)
  return { image, data: context.getImageData(0, 0, width, height).data, width, height }
}

/** The picture `width` px wide, its alpha flattened onto black as the PDF's decode does. */
async function sampleOf(
  url: string,
  width: (image: HTMLImageElement) => number,
): Promise<PrintPhotoSample & { image: HTMLImageElement }> {
  const decoded = await decode(url, (image) => {
    const across = Math.max(1, Math.round(width(image)))
    return [
      across,
      Math.max(1, Math.round((across * image.naturalHeight) / image.naturalWidth)),
    ]
  })
  const rgb = new Uint8ClampedArray(decoded.width * decoded.height * 3)
  for (let pixel = 0; pixel < decoded.width * decoded.height; pixel++) {
    const alpha = (decoded.data[pixel * 4 + 3] ?? 0) / 255
    for (let channel = 0; channel < 3; channel++) {
      rgb[pixel * 3 + channel] = (decoded.data[pixel * 4 + channel] ?? 0) * alpha
    }
  }
  return { widthPx: decoded.width, heightPx: decoded.height, rgb, image: decoded.image }
}

async function readPhoto(url: string): Promise<PreviewPhoto> {
  const sample = await sampleOf(url, () => PRINT_SAMPLE_WIDTH_PX)
  const detail = await sampleOf(url, (image) =>
    Math.min(PRINT_DETAIL_WIDTH_PX, image.naturalWidth),
  )
  const { naturalWidth, naturalHeight } = sample.image
  return { sample, detail, pixels: { widthPx: naturalWidth, heightPx: naturalHeight } }
}

async function readLogo(url: string): Promise<PreviewLogo> {
  const decoded = await decode(url, (image) => {
    const scale = Math.min(
      1,
      PRINT_LOGO_TONE_SIZE_PX / Math.max(image.naturalWidth, image.naturalHeight),
    )
    return [
      Math.max(1, Math.round(image.naturalWidth * scale)),
      Math.max(1, Math.round(image.naturalHeight * scale)),
    ]
  })
  return {
    aspect: decoded.image.naturalWidth / decoded.image.naturalHeight,
    medianInkLuminance: printMedianInkLuminance(decoded.data, {
      width: decoded.width,
      height: decoded.height,
      channels: 4,
    }),
  }
}

export type PictureRead<T> =
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'reading' }>
  | Readonly<{ status: 'read'; value: T }>
  | Readonly<{ status: 'failed' }>

type Held<T> = Readonly<{ url: string; read: PictureRead<T> }>

function usePicture<T>(
  url: string | null,
  read: (url: string) => Promise<T>,
): PictureRead<T> {
  const [held, setHeld] = useState<Held<T> | null>(null)
  useEffect(() => {
    if (url === null) return undefined
    let current = true
    read(url).then(
      (value) => {
        if (current) setHeld({ url, read: { status: 'read', value } })
      },
      () => {
        if (current) setHeld({ url, read: { status: 'failed' } })
      },
    )
    return () => {
      current = false
    }
  }, [url, read])
  if (url === null) return { status: 'none' }
  return held?.url === url ? held.read : { status: 'reading' }
}

/** The pictures a page decodes are few: the photo and the logo, kept by address. */
const REMEMBERED_PICTURES = 4

/**
 * `read`, run once per address: the face on its own and every cell of the sheet
 * ask for the same photo, and decoding it is the costly part. A failed read is
 * forgotten, so the next mount tries again.
 */
function remembered<T>(read: (url: string) => Promise<T>): (url: string) => Promise<T> {
  const reads = new Map<string, Promise<T>>()
  return (url) => {
    const held = reads.get(url)
    if (held !== undefined) return held
    const reading = read(url)
    reads.set(url, reading)
    if (reads.size > REMEMBERED_PICTURES) {
      const [oldest] = reads.keys()
      if (oldest !== undefined) reads.delete(oldest)
    }
    reading.catch(() => reads.delete(url))
    return reading
  }
}

const readPhotoOnce = remembered(readPhoto)
const readLogoOnce = remembered(readLogo)

/** The photo as the preview reads it, once decoded. */
export const usePreviewPhoto = (url: string | null): PictureRead<PreviewPhoto> =>
  usePicture(url, readPhotoOnce)

/** The logo's proportions and ink, once decoded. */
export const usePreviewLogo = (url: string | null): PictureRead<PreviewLogo> =>
  usePicture(url, readLogoOnce)
