import { createFileRoute } from '@tanstack/react-router'
import notice from '../../docs/legal/privacy-notice.md?raw'
import { LegalMarkdown, renderLegalMarkdown } from './-legal-markdown'

const html = renderLegalMarkdown(notice)

export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: [{ title: 'Privacy Notice | Reputation Key' }],
  }),
  component: PrivacyNoticePage,
})

function PrivacyNoticePage() {
  return <LegalMarkdown html={html} />
}
