import { useCallback, useEffect, useRef, useState } from 'react'
import {
  prepareScreenshot,
  type PreparedScreenshot,
  type ScreenshotRefusal,
} from './beta-feedback-screenshot-encode'

export type BetaFeedbackScreenshotState =
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'preparing' }>
  | Readonly<{ status: 'ready'; prepared: PreparedScreenshot; previewUrl: string }>
  | Readonly<{ status: 'refused'; reason: ScreenshotRefusal }>

const EMPTY: BetaFeedbackScreenshotState = { status: 'empty' }
const PREPARING: BetaFeedbackScreenshotState = { status: 'preparing' }

/** The first image among pasted, dropped or chosen files, if there is one. */
export function firstImageFile(files: ArrayLike<File> | null | undefined): File | null {
  return Array.from(files ?? []).find((file) => file.type.startsWith('image/')) ?? null
}

/**
 * The reporter's one optional screenshot. A newer attach supersedes one still
 * being prepared, and the preview's object URL is released whenever the
 * screenshot is replaced or removed, or the form goes away.
 */
export function useBetaFeedbackScreenshot() {
  const [state, setState] = useState<BetaFeedbackScreenshotState>(EMPTY)
  const generation = useRef(0)
  const previewUrl = useRef<string | null>(null)

  const release = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
  }, [])

  useEffect(() => release, [release])

  const attach = useCallback(
    async (file: Blob) => {
      generation.current += 1
      const current = generation.current
      release()
      setState(PREPARING)
      const result = await prepareScreenshot(file)
      if (current !== generation.current) return
      if (!result.ok) {
        setState({ status: 'refused', reason: result.reason })
        return
      }
      previewUrl.current = URL.createObjectURL(result.prepared.blob)
      setState({
        status: 'ready',
        prepared: result.prepared,
        previewUrl: previewUrl.current,
      })
    },
    [release],
  )

  const remove = useCallback(() => {
    generation.current += 1
    release()
    setState(EMPTY)
  }, [release])

  return { state, attach, remove } as const
}
