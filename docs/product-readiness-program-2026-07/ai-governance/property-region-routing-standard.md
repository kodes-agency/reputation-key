# Property-Region Routing Standard

**Status:** Proposed normative standard  
**Product decision:** The property, not the organization or current user, is the routing unit  
**Owners:** Engineering, privacy, operations  
**Related:** [Primary-source research](../ai-governance-primary-sources-2026-07-14.md), [source-content policy](source-content-policy-specification.md)

## 1. Purpose and claim boundary

Property-region routing selects the approved application/provider processing path for one property's work. It is a risk-reduction and contract-enforcement control; it is not, by itself, a promise that all data is resident in that region.

Any customer-facing “EU processing,” “US processing,” or “data residency” claim must separately account for application storage, queues, inference, provider state/abuse monitoring, system metadata, support access, subprocessors, backup/disaster recovery, and failover. The provider assessment and privacy review own that full claim.

## 2. Canonical model

```ts
type ProcessingRegion = 'us' | 'europe' | 'global' | 'unresolved'

type PropertyProcessingProfile = Readonly<{
  propertyId: string
  countryCode: string
  countrySource:
    | 'google_address'
    | 'organization_default'
    | 'authorized_manual_correction'
  timeZone: string
  timeZoneSource:
    | 'google_time_zone'
    | 'organization_default'
    | 'authorized_manual_correction'
  processingRegion: ProcessingRegion
  regionSource: 'country_default' | 'contract_override' | 'authorized_privacy_override'
  routingPolicyVersion: number
  resolvedAt: Date
  reviewedAt?: Date
}>

type ProcessingAvailability =
  | { available: true; profile: PropertyProcessingProfile }
  | {
      available: false
      reason:
        | 'country_unresolved'
        | 'timezone_unresolved'
        | 'region_unresolved'
        | 'provider_deployment_unavailable'
        | 'provider_approval_expired'
        | 'transfer_control_missing'
    }
```

`us`, `europe`, and `global` are RepKey processing cells, not Azure/AWS/OpenAI region names. A separate Provider Deployment registry maps one processing cell to one exact approved provider/model/deployment/configuration.

## 3. Routing inputs

### Authoritative inputs

1. Validated property country from the authorized Business Profile or an authorized correction.
2. Explicit contract/privacy override approved for that property or customer.
3. Current versioned country-to-cell routing table.
4. Available approved Provider Deployments and transfer/privacy controls.

### Inputs that must not determine the route

- current manager IP/location;
- organization headquarters alone;
- browser locale or UI language;
- review language;
- worker/container/cloud region;
- provider automatic/global routing; or
- an unreviewed organization preference.

Country is a routing input, not proof of customer consent, lawful basis, transfer mechanism, or complete residency.

## 4. Initial routing policy

The actual country list lives in versioned executable configuration and must be reviewed by privacy/operations before activation.

| Property classification | Default cell           | Conditions                                                                                          |
| ----------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| United States           | `us`                   | Approved US deployment and full-path data-flow evidence                                             |
| EEA                     | `europe`               | Approved European deployment; applicable processor/transfer controls; no global inference fallback  |
| United Kingdom          | `unresolved` initially | Route to `europe` only after explicit privacy/contract decision and approved provider path          |
| Switzerland             | `unresolved` initially | Route to `europe` only after explicit privacy/contract decision and approved provider path          |
| Other supported country | `global`               | Only after country/support/privacy review and an approved global or appropriate regional deployment |
| Missing/invalid country | `unresolved`           | AI unavailable; prompt for authorized correction; non-AI features continue                          |

Canada and other high-priority markets are not silently classified as `us`; they follow the reviewed rest-of-world map. “Europe” is a processing cell, not a claim that every European country has identical law or transfer requirements.

## 5. Resolution and change workflow

### On property onboarding/import

1. Validate the source country code and IANA time zone.
2. Resolve the current routing-policy version.
3. Apply only approved contract/privacy overrides.
4. Persist the complete Property Processing Profile and a content-free resolution event.
5. Keep AI disabled if any required value is unresolved or the cell lacks an approved Provider Deployment.

### On country, contract, or routing-policy change

1. Mark the profile `unresolved` or pending review before scheduling new AI work if the destination changes.
2. Increment/update the routing-policy version and AI Enablement Epoch when the approved provider/region or notice changes materially.
3. Prevent stale queued work from using the old cell.
4. Do not copy existing raw or derived data to the new cell automatically.
5. Assess source lifecycle, provider deletion, customer notice, transfer, and migration requirements.
6. Re-enable only after the new path passes the relevant evidence gate.

Historical control records keep the region/deployment version used at processing time.

## 6. Provider Deployment registry

```ts
type ProviderDeploymentApproval = Readonly<{
  deploymentId: string
  provider: string
  service: string
  modelOrFamily: string
  endpointOrDeploymentType: string
  processingCell: Exclude<ProcessingRegion, 'unresolved'>

  configuredCloudRegionOrZone: string
  allowedInferenceLocations: readonly string[]
  storageLocations: readonly string[]
  providerStateAndAbuseMonitoringLocations: readonly string[]
  supportAccessLocations: readonly string[]
  metadataExclusions: readonly string[]
  backupAndFailoverLocations: readonly string[]

  retentionMode: string
  trainingUse: 'disabled'
  humanAccessMode: string
  transferControlRef?: string
  providerAssessmentId: string
  configurationEvidenceRef: string
  approvalVersion: string
  approvedAt: Date
  approvalExpiresAt: Date
  status: 'approved' | 'suspended' | 'expired' | 'revoked'
}>
```

Approval is for the exact combination. A provider brand or cloud account is not an approval. Global Azure deployments, global Bedrock inference profiles, or OpenAI projects without the required regional processing configuration cannot satisfy a narrower property cell merely because their resource/project has a regional label.

## 7. Routing algorithm

```text
propertyId
  → load current Property Processing Profile
  → require resolved cell and current routing policy
  → load active Merchant AI Opt-in/capability/epoch
  → select exactly one approved deployment for that cell and operation
  → require provider approval and transfer evidence current
  → issue deployment-bound credentials/endpoint
  → invoke without provider/global fallback
  → persist route/deployment/policy evidence
```

Selection must be deterministic or explainable and must never search broader cells after failure. Capacity failover is allowed only between preapproved deployments inside the same cell and with compatible policy/configuration. If none is healthy, return/record `regional_ai_unavailable` and leave non-AI features working.

## 8. Infrastructure controls

- Separate deployment identifiers, endpoints, credentials/workload identities, queues, and quotas by processing cell.
- Prevent a worker from choosing a cell based on its own deployment region; it obeys the property's profile.
- Network/IAM policy should allow only approved endpoints for that cell where technically feasible.
- Deny provider “global” inference profiles/SKUs for `us` or `europe` routes unless the exact full path is explicitly approved as equivalent.
- Keep prompt/review content out of URL/query parameters, logs, gateway access logs, and observability attributes.
- Export provider and cloud policy/configuration as release evidence, redacting secrets.
- Monitor calls by deployment ID and processing cell; alert on mismatches, unknown endpoints, approval expiry, or use outside allowlisted locations.
- Do not put organization/property identifiers into high-cardinality infrastructure metrics; keep them in access-controlled control records/traces where approved.

## 9. Regional failure behavior

| Failure                                      | Required behavior                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Country/time zone unresolved                 | AI unavailable for property; onboarding/operator remediation; non-AI continues                  |
| No approved deployment in cell               | Fail closed; do not route globally                                                              |
| Approved regional endpoint unavailable       | Retry/fail over only within same approved cell; otherwise graceful unavailable                  |
| Provider changes retention/location behavior | Suspend deployment; deny new calls until reassessed                                             |
| Routing policy version unknown               | Deny new AI work; alert configuration owner                                                     |
| Property changes country                     | Invalidate profile/epoch; stop queued work; assess migration before re-enable                   |
| Transfer/control evidence expires            | Suspend affected deployment even if technically healthy                                         |
| Misrouted call detected                      | Stop affected deployment/capability; preserve content-free evidence; execute incident procedure |

## 10. Verification matrix

### Unit tests

- Every supported country resolves under a pinned routing-policy version.
- Unknown/invalid countries resolve to `unresolved`, never `global`.
- Contract/privacy overrides require correct authority and version.
- Provider deployment cell must equal property cell.
- Expired/suspended deployments and missing transfer controls deny.

### Integration tests

- US, EEA, rest-of-world, UK/Swiss unresolved, missing-country, and override fixtures.
- Background and interactive paths produce the same route decision.
- Queue retry, provider failure, and capacity exhaustion never fall back to another cell.
- Region/profile change invalidates old queued work through source/enablement epochs.
- Credentials/endpoints for one cell cannot invoke another cell in staging policy tests.

### Operational evidence

- Versioned country map and review approval.
- Configuration exports for exact provider deployment type, region/zone, retention, logging/abuse monitoring, and failover.
- Data-flow map for storage, queues, inference, provider state, metadata, support, subprocessors, backups, and DR.
- A same-cell failover test and a no-global-fallback failure drill.
- Alert test for deliberate route/deployment mismatch.
- Privacy/transfer decision for Europe and any contract overrides.

## 11. Review triggers

Reapprove the routing standard or affected deployment when any of these changes:

- country-to-cell map;
- provider/model/endpoint/deployment SKU;
- processing, storage, monitoring, support, subprocessor, backup, or failover location;
- retention/human-access/training configuration;
- contracting entity, DPA, transfer mechanism, or regional claim;
- property country or material customer contract; or
- new AI capability, data class, or supported country.

At minimum, revalidate provider documentation/configuration quarterly while real AI processing is active and before each material AI release.
