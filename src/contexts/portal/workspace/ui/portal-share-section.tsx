// The Share tab's section: it reads the responsible managers and the members
// that name them, says so itself while they load or if they cannot be read, and
// then draws the Share screen. The route hands in the reads and the commands;
// nothing else of the workspace waits on them.

import { resolveFixPeople } from '#/components/features/portal/portal-review/portal-review-checks'
import { PortalShare } from '#/components/features/portal/portal-share/portal-share'
import type {
  IssuedPortalLink,
  PortalShareMutations,
  RotatePortalLinkInput,
} from '#/components/features/portal/portal-share/portal-share-types'
import type {
  PortalPrintKitReader,
  PortalPrintKitResources,
} from '#/components/features/portal/portal-share/portal-print-kit-types'
import type { PortalLinkIssuance } from '#/components/features/portal/portal-workspace/portal-link-issuance'
import type { Action } from '#/components/hooks/use-action'
import type { PortalTokenStatus } from '#/contexts/portal/application/portal-management-contracts'
import type {
  PortalDetailPortal,
  PortalResponsibleManagerState,
  ResponsibleManagerMember,
} from './portal-detail-types'
import { PortalReadState, type SectionRead } from './portal-read-state'

export type PortalShareCommands = Readonly<{
  issueToken: Action<{ data: { portalId: string } }, IssuedPortalLink>
  rotateToken: Action<{ data: RotatePortalLinkInput }, IssuedPortalLink>
  revokeToken: Action<{ data: { portalId: string; reason: string } }, unknown>
  /** "Download again": the live code's address, from its sealed copy. */
  revealAddress: PortalShareMutations['revealMutation']
  /** The print kit's read and its two commands. Absent: the tab offers no print kit. */
  printKit?: Readonly<{
    read: PortalPrintKitReader
    downloadPrint: PortalPrintKitResources['downloadPrintMutation']
    /** "Save wording" in the final print kit: Share opens on the words saved. */
    saveWording?: PortalPrintKitResources['saveWordingMutation']
  }>
}>

type Props = Readonly<{
  portal: PortalDetailPortal
  tokenStatus: PortalTokenStatus
  /** The property's IANA zone (the old code's cutoff is counted in its days) and its country (the print kit's paper). */
  property: Readonly<{ timeZone: string; countryCode: string | null }>
  reads: Readonly<{
    managers: SectionRead<PortalResponsibleManagerState>
    members: SectionRead<{ members: readonly ResponsibleManagerMember[] }>
  }>
  commands: PortalShareCommands
  issuance: PortalLinkIssuance
}>

export function PortalShareSection({
  portal,
  tokenStatus,
  property,
  reads,
  commands,
  issuance,
}: Props) {
  const { managers, members } = reads
  if (!managers.data || !members.data) {
    return <PortalReadState queries={[managers, members]} label="sharing details" />
  }
  const { printKit } = commands
  return (
    <PortalShare
      portalId={portal.id}
      portalName={portal.name}
      propertyId={portal.propertyId}
      publicationState={portal.publicationState}
      timeZone={property.timeZone}
      countryCode={property.countryCode}
      managerNames={resolveFixPeople(managers.data, members.data.members).map(
        (person) => person.name,
      )}
      issuedLink={issuance.issuedLink}
      revoked={issuance.linksRevoked}
      tokenStatus={tokenStatus}
      onLinkIssued={issuance.onLinkIssued}
      onAddressRevealed={issuance.onAddressRevealed}
      onLinksRevoked={issuance.onLinksRevoked}
      issueMutation={commands.issueToken}
      rotateMutation={commands.rotateToken}
      revokeMutation={commands.revokeToken}
      revealMutation={commands.revealAddress}
      printKit={
        printKit
          ? {
              read: printKit.read,
              downloadPrintMutation: printKit.downloadPrint,
              saveWordingMutation: printKit.saveWording,
            }
          : undefined
      }
    />
  )
}
