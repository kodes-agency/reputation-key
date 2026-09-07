import { createFileRoute } from '@tanstack/react-router'
import disclosure from '../../docs/legal/google-access-disclosure.md?raw'
import { LegalMarkdown, renderLegalMarkdown } from './-legal-markdown'

const html = renderLegalMarkdown(disclosure)

export const Route = createFileRoute('/privacy_/google-access-disclosure')({
  head: () => ({
    meta: [{ title: 'Google Business Profile Access Disclosure | Reputation Key' }],
  }),
  component: GoogleAccessDisclosurePage,
})

function GoogleAccessDisclosurePage() {
  return <LegalMarkdown html={html} />
}
