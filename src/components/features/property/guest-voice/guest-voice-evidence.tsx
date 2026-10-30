import { StrongSectionTitle as SectionTitle } from '#/components/ui/section-title-strong'
import type {
  IssueDrawer,
  GuestVoiceConcernDrawer,
} from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceQuote } from './guest-voice-quote'

export function GuestVoiceEvidence({
  drawer,
}: Readonly<{ drawer: IssueDrawer | GuestVoiceConcernDrawer }>) {
  const { propertyId } = useGuestVoice()
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle level={3}>In guests’ own words</SectionTitle>
      {!drawer.liveEvidence.length ? (
        <p className="text-sm text-muted-foreground">
          None of these reviews can be quoted here. You can read available reviews in the
          Inbox.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {drawer.liveEvidence.map((evidence) => (
            <li key={evidence.inboxItemId}>
              <GuestVoiceQuote
                evidence={evidence}
                sense={drawer.kind === 'issue' ? drawer.sense : 'complaint'}
                propertyId={propertyId}
              />
            </li>
          ))}
        </ul>
      )}
      {drawer.liveEvidence.length ? (
        <p className="text-sm text-muted-foreground">
          The underlined sentence is the part we counted. A review that names a team
          member is never quoted.
        </p>
      ) : null}
    </section>
  )
}
