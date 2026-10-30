import { useEffect, useRef, useState } from 'react'
import type { ReplyDraftCheckDto } from '#/contexts/review/application/dto/reply-library.dto'

export type CheckReplyDraft = (text: string) => Promise<ReplyDraftCheckDto>

/**
 * Debounces the checks for one reply text and ignores answers superseded by a
 * newer text. The callback lives in a ref because mutation wrappers may return
 * a fresh closure after their own state changes; that must not restart a check
 * for text that has not changed.
 */
export function useReplyDraftChecks(
  text: string,
  onCheck: CheckReplyDraft | undefined,
): ReplyDraftCheckDto | null {
  const [snapshot, setSnapshot] = useState<Readonly<{
    text: string
    result: ReplyDraftCheckDto
  }> | null>(null)
  const checkSequence = useRef(0)
  const checkRef = useRef(onCheck)
  const hasCheck = onCheck !== undefined

  useEffect(() => {
    checkRef.current = onCheck
  }, [onCheck])

  useEffect(() => {
    checkSequence.current += 1
    const sequence = checkSequence.current
    if (!hasCheck || text.trim().length === 0) return
    const timer = window.setTimeout(() => {
      const check = checkRef.current
      if (!check) return
      void check(text)
        .then((result) => {
          if (sequence === checkSequence.current) setSnapshot({ text, result })
        })
        .catch(() => undefined)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [text, hasCheck])

  return hasCheck && text.trim().length > 0 && snapshot?.text === text
    ? snapshot.result
    : null
}
