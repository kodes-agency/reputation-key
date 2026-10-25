// The pictures of a final Immersive face as the Share tab's preview reads them
// (final design spec §4 and §6): the photo decoded small, 240 px wide for the
// ground and the kicker and up to 960 px wide for what lies under each word, as
// the PDF decodes it; and the logo, for its proportions and how light its ink
// is. The browser decodes with a canvas; the pictures are same-origin media
// paths, so the canvas can be read.

import { useEffect, useState } from 'react'
import {
  PRINT_FINAL_LOGO_TONE_SIZE_PX,
  printFinalMedianInkLuminance,
} from '#/shared/domain/portal-print-final-brand'
import type { PrintFinalPhotoPixels } from '#/shared/domain/portal-print-final-photo'
import {
  PRINT_FINAL_DETAIL_WIDTH_PX,
  PRINT_FINAL_SAMPLE_WIDTH_PX,
  type PrintFinalPhotoSample,
} from '#/shared/domain/portal-print-final-photo-sample'

export type PreviewFinalPhoto = Readonly<{
  sample: PrintFinalPhotoSample
  detail: PrintFinalPhotoSample
  pixels: PrintFinalPhotoPixels
}>

export type PreviewFinalLogo = Readonly<{
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
): Promise<PrintFinalPhotoSample & { image: HTMLImageElement }> {
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

async function readPhoto(url: string): Promise<PreviewFinalPhoto> {
  const sample = await sampleOf(url, () => PRINT_FINAL_SAMPLE_WIDTH_PX)
  const detail = await sampleOf(url, (image) =>
    Math.min(PRINT_FINAL_DETAIL_WIDTH_PX, image.naturalWidth),
  )
  const { naturalWidth, naturalHeight } = sample.image
  return { sample, detail, pixels: { widthPx: naturalWidth, heightPx: naturalHeight } }
}

async function readLogo(url: string): Promise<PreviewFinalLogo> {
  const decoded = await decode(url, (image) => {
    const scale = Math.min(
      1,
      PRINT_FINAL_LOGO_TONE_SIZE_PX / Math.max(image.naturalWidth, image.naturalHeight),
    )
    return [
      Math.max(1, Math.round(image.naturalWidth * scale)),
      Math.max(1, Math.round(image.naturalHeight * scale)),
    ]
  })
  return {
    aspect: decoded.image.naturalWidth / decoded.image.naturalHeight,
    medianInkLuminance: printFinalMedianInkLuminance(decoded.data, {
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

/** The photo as the preview reads it, once decoded. */
export const usePreviewFinalPhoto = (
  url: string | null,
): PictureRead<PreviewFinalPhoto> => usePicture(url, readPhoto)

/** The logo's proportions and ink, once decoded. */
export const usePreviewFinalLogo = (url: string | null): PictureRead<PreviewFinalLogo> =>
  usePicture(url, readLogo)
