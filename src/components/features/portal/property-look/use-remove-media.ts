// Taking the photograph or the logo off: one write at once, whose refusal is said
// beside the button (the server's own sentence for a 4xx, `fallback` for a
// failure a second try could cure) and never lost.

import { useState } from 'react'
import { refusalOf } from './property-look-rules'

export function useRemoveMedia(remove: () => Promise<void>, fallback: string) {
  const [isRemoving, setIsRemoving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const run = async () => {
    setIsRemoving(true)
    setFailure(null)
    try {
      await remove()
    } catch (error) {
      setFailure(refusalOf(error) ?? fallback)
    } finally {
      setIsRemoving(false)
    }
  }
  return { isRemoving, failure, remove: run }
}
