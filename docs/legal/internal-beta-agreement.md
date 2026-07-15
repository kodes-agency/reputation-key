# Internal Beta Agreement — Reputation Key

**Status:** Draft — pending legal review
**Date:** 2026-07-14
**Version:** 1.0-draft
**Accountable owner:** Bozhidar Denev (product, privacy, security)

## 1. Parties

This agreement governs the internal beta of Reputation Key ("the Service") between Kodes Agency ("the Operator") and the internal team members designated as beta participants ("the Participants").

## 2. Purpose

The Service enables businesses to manage their online reputation by synchronizing Google Business Profile reviews, providing an inbox for triage, and publishing human-authored replies. The internal beta validates operational readiness before external beta or AI feature enablement.

## 3. Beta scope

### 3.1 Enabled

- User identity, authentication, and session management
- Organization and property management (operator-allowlisted)
- Google Business Profile OAuth connection and review synchronization
- Review inbox: triage, assignment, escalation, notes
- Manual reply drafting, approval, and publication to Google
- Property-local dashboard (metrics, rating trends, response performance)
- In-app notifications (review events, assignment changes)

### 3.2 Disabled (not part of this beta)

- Public registration and self-service organization creation
- AI analysis, reply generation, and trend detection (ADR 0031 gate)
- Public portal, guest QR/NFC, and guest submissions
- External email notifications (except identity-verification email)
- Goals, badges, and leaderboards
- Cross-property analytics or reporting
- Custom/dynamic roles

### 3.3 Capacity

The beta targets up to 5,000 properties and 500,000 new reviews per month. Initial pilot begins with a single US property and expands in controlled stages.

## 4. Data handling

### 4.1 Google-sourced content

The Service synchronizes review data from the Participant's connected Google Business Profile. This includes reviewer name, rating, review text, and reviewer profile photo. This content is cached for a maximum of 30 days from initial fetch, after which it is automatically purged (ADR 0031). Derived metadata (rating counts, response times, status) is retained for operational purposes.

### 4.2 User-authored content

Reply drafts, inbox notes, and feedback are stored for the lifetime of the property unless explicitly deleted. Published replies are also submitted to Google.

### 4.3 Credentials

Google OAuth tokens are encrypted at rest using AES-256-GCM. The Operator cannot decrypt or use tokens outside the Service's automated sync workflow.

### 4.4 Backups

Database backups (point-in-time recovery, ≤15-minute RPO) contain all data including review content. Review content in backups expires via the same 30-day TTL on the next purge cycle after restore.

## 5. Subprocessors

| Provider                           | Purpose                                          | Region                | Data accessed                                                  |
| ---------------------------------- | ------------------------------------------------ | --------------------- | -------------------------------------------------------------- |
| Neon (Neon Labs, Inc.)             | PostgreSQL database hosting                      | US (pilot)            | All application data                                           |
| Resend (Resend, Inc.)              | Transactional email (identity verification only) | US                    | Recipient email address                                        |
| Amazon Web Services (S3)           | Object storage (portal images, when enabled)     | EU-West-3 (eu-west-3) | Uploaded images                                                |
| Sentry (Functional Software, Inc.) | Error monitoring and performance tracing         | US (ingest)           | Error stack traces, request metadata (no PII by configuration) |

## 6. Participant responsibilities

1. Use only properties you are authorized to manage.
2. Do not publish automated, AI-generated, or templated replies to Google. All replies must be human-authored and manually approved.
3. Do not share credentials or session access.
4. Report unexpected behavior, errors, or data issues to the Operator immediately.
5. Do not attempt to access data belonging to other organizations or properties.
6. Acknowledge that the Service may have bugs, performance limitations, and incomplete features.

## 7. Operator responsibilities

1. Maintain the security envelope described in the BETA-0 plan.
2. Monitor for tenant isolation breaches, data loss, and duplicate effects.
3. Apply security patches within the SLAs defined in ADR 0038.
4. Maintain backup and recovery capability (RPO ≤15 min, RTO ≤4 hr).
5. Suspend the beta automatically if any stop condition in ADR 0038 is triggered.
6. Provide operational support during business hours.

## 8. Data subject rights

Participants may request:

- **Access**: a copy of their personal data stored by the Service.
- **Correction**: update of incorrect personal data.
- **Deletion**: removal of their account and associated data.
- **Export**: machine-readable export of their data.
- **Disconnect**: disconnection of their Google Business Profile and purge of associated review content.

Requests should be directed to **Bozhidar Denev** and will be processed within 30 days.

## 9. Term and termination

The beta continues until the Operator announces external beta readiness or terminates the beta. Participants may withdraw at any time by requesting account deletion. On termination:

- Google connections are disconnected and tokens purged.
- Review content is purged (30-day TTL applies to any remaining cached content).
- User accounts and associated data are deleted.
- Derived metrics and audit logs are retained for 90 days for operational continuity.

## 10. Limitations

The Service is provided "as is" without warranty of merchantability or fitness for a particular purpose. The Operator's liability is limited to the value of the beta (which is provided at no cost to internal Participants).

## 11. Acceptance

By using the Service, the Participant acknowledges they have read and understood this agreement.

---

**Contact:** Bozhidar Denev
