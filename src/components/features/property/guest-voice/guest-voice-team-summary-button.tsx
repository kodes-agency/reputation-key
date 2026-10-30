import { useEffect, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { copyToClipboard } from '#/lib/clipboard'
import type { GuestVoiceV2Ready } from '#/contexts/ai/application/public-api'
import { guestVoiceTeamSummary } from './guest-voice-team-summary'

export function GuestVoiceTeamSummaryButton({
  read,
  copy = copyToClipboard,
}: Readonly<{ read: GuestVoiceV2Ready; copy?: typeof copyToClipboard }>) {
  const [outcome, setOutcome] = useState<'idle' | 'copied' | 'failed'>('idle')
  const manual = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (outcome === 'failed') {
      manual.current?.focus()
      manual.current?.select()
    }
    if (outcome !== 'copied') return
    const timer = setTimeout(() => setOutcome('idle'), 3000)
    return () => clearTimeout(timer)
  }, [outcome])
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        onClick={async () =>
          setOutcome((await copy(guestVoiceTeamSummary(read))) ? 'copied' : 'failed')
        }
      >
        <Copy aria-hidden="true" />
        {outcome === 'copied' ? 'Copied' : 'Copy team summary'}
      </Button>
      <p role="status" className="text-xs text-muted-foreground">
        {outcome === 'failed'
          ? 'Couldn’t copy. Select and copy the note below.'
          : outcome === 'copied'
            ? 'Team summary copied.'
            : 'A short note for your team. No guests’ words.'}
      </p>
      {outcome === 'failed' ? (
        <Textarea
          ref={manual}
          aria-label="Team summary for manual copy"
          readOnly
          value={guestVoiceTeamSummary(read)}
          rows={8}
        />
      ) : null}
    </div>
  )
}
