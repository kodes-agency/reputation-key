import { createFileRoute } from '@tanstack/react-router'
import agreement from '../../docs/legal/internal-beta-agreement.md?raw'
import { LegalMarkdown, renderLegalMarkdown } from './-legal-markdown'

const html = renderLegalMarkdown(agreement)

export const Route = createFileRoute('/privacy_/beta-agreement')({
  head: () => ({
    meta: [{ title: 'Beta Agreement | Reputation Key' }],
  }),
  component: BetaAgreementPage,
})

function BetaAgreementPage() {
  return <LegalMarkdown html={html} />
}
