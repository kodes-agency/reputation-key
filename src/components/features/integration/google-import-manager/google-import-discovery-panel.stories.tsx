import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type {
  ImportAccountDto,
  ImportCandidateDto,
} from '#/contexts/integration/application/public-api'
import { GoogleImportDiscoveryPanel } from './google-import-discovery-panel'
import {
  filterLoadedCandidates,
  toggleSelectedCandidate,
} from './google-import-selection'

const accounts: readonly ImportAccountDto[] = [
  { accountRef: 'account.north', displayName: 'North region', role: 'primary_owner' },
  { accountRef: 'account.west', displayName: 'West region', role: 'manager' },
]

const candidates: readonly ImportCandidateDto[] = [
  {
    candidateId: 'candidate-meridian',
    candidateRef: 'candidate.meridian',
    accountRef: 'account.north',
    accountDisplayName: 'North region',
    businessName: 'The Meridian Grand Resort',
    address: '100 Harbor Boulevard, San Francisco, CA',
    primaryCategory: 'Hotel',
    countryCode: 'US',
    eligibility: { kind: 'create' },
  },
  {
    candidateId: 'candidate-cafe',
    candidateRef: 'candidate.cafe',
    accountRef: 'account.north',
    accountDisplayName: 'North region',
    businessName: 'Juniper Street Café',
    address: '28 Juniper Street, Oakland, CA',
    primaryCategory: 'Cafe',
    countryCode: 'US',
    eligibility: { kind: 'create' },
  },
  {
    candidateId: 'candidate-existing',
    candidateRef: null,
    accountRef: 'account.north',
    accountDisplayName: 'North region',
    businessName: 'Riverside Suites',
    address: '2 River Walk, Sacramento, CA',
    primaryCategory: 'Hotel',
    countryCode: 'US',
    eligibility: {
      kind: 'already_imported',
      propertyId: '10000000-0000-4000-8000-000000000001' as never,
    },
  },
]

function DiscoveryHarness() {
  const [selectedAccountRef, setSelectedAccountRef] = useState<string | null>(
    'account.north',
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const filtered = filterLoadedCandidates(candidates, search)

  return (
    <GoogleImportDiscoveryPanel
      accounts={accounts}
      candidates={filtered}
      selectedAccountRef={selectedAccountRef}
      selectedIds={selectedIds}
      search={search}
      isLoadingAccounts={false}
      isLoadingMoreAccounts={false}
      hasMoreAccounts
      isLoadingCandidates={false}
      isLoadingMoreCandidates={false}
      hasMoreCandidates
      accountsError={null}
      candidatesError={null}
      onSearchChange={setSearch}
      onSelectAccount={setSelectedAccountRef}
      onToggleCandidate={(candidate, checked) => {
        const result = toggleSelectedCandidate(selectedIds, candidate, checked)
        setSelectedIds(new Set(result.selectedIds))
      }}
      onToggleLoaded={(checked) => {
        setSelectedIds(
          checked
            ? new Set(
                filtered
                  .filter((candidate) => candidate.candidateRef !== null)
                  .map((candidate) => candidate.candidateId),
              )
            : new Set(),
        )
      }}
      onLoadMoreAccounts={() => {}}
      onLoadMoreCandidates={() => {}}
      onReview={() => {}}
    />
  )
}

const meta: Meta<typeof GoogleImportDiscoveryPanel> = {
  title: 'Integration/GoogleImport/DiscoveryPanel',
  component: GoogleImportDiscoveryPanel,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof GoogleImportDiscoveryPanel>

export const Loaded: Story = {
  render: () => <DiscoveryHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('The Meridian Grand Resort')[0]).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: /review properties/i }),
    ).toBeDisabled()
    await userEvent.click(
      canvas.getAllByRole('checkbox', { name: /select the meridian/i })[0]!,
    )
    await expect(canvas.getByRole('button', { name: /review 1 property/i })).toBeEnabled()
    await userEvent.type(canvas.getByRole('textbox', { name: /search loaded/i }), 'café')
    await expect(canvas.getAllByText('Juniper Street Café')[0]).toBeVisible()
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

export const Loading: Story = {
  args: {
    accounts: [],
    candidates: [],
    selectedAccountRef: null,
    selectedIds: new Set(),
    search: '',
    isLoadingAccounts: true,
    isLoadingMoreAccounts: false,
    hasMoreAccounts: false,
    isLoadingCandidates: false,
    isLoadingMoreCandidates: false,
    hasMoreCandidates: false,
    accountsError: null,
    candidatesError: null,
    onSearchChange: () => {},
    onSelectAccount: () => {},
    onToggleCandidate: () => {},
    onToggleLoaded: () => {},
    onLoadMoreAccounts: () => {},
    onLoadMoreCandidates: () => {},
    onReview: () => {},
  },
}

export const ProviderUnavailable: Story = {
  args: {
    ...Loading.args,
    isLoadingAccounts: false,
    accountsError: 'Google Business Profile is temporarily unavailable.',
  },
}
