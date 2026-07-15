# Privacy Notice — Reputation Key Internal Beta

**Status:** Draft — pending legal review
**Date:** 2026-07-14
**Version:** 1.0-draft
**Accountable owner:** Bozhidar Denev

## Overview

This notice describes how Reputation Key ("the Service") collects, uses, and protects personal data during the internal beta. The Service is operated by Kodes Agency.

## What data we collect

### Data you provide

- **Account information**: Your name and email address when you are invited to the beta.
- **Organization details**: Organization name and property information you enter.
- **Content you author**: Reply drafts, inbox notes, and feedback you submit.

### Data from Google Business Profile

When you connect your Google Business Profile, the Service synchronizes:

- **Reviews**: Reviewer name, rating, review text, language, review date, and reviewer profile photo URL.
- **Reply status**: Whether a reply has been published, its approval state, and publication timestamps.

This Google-sourced review content is cached for a **maximum of 30 days** from initial synchronization and then automatically deleted. The Service re-fetches content from Google on a refresh cycle to maintain the inbox. Identifiers and derived metrics (counts, averages) are retained for operational use.

### Automatically collected data

- **Session data**: IP address (for security), user agent, session timestamps.
- **Audit log**: Your actions within the Service (with your user ID and IP address) for security and operational audit.
- **Guest interactions** (when guest features are enabled in a future phase): IP addresses are hashed before storage; raw IPs are never persisted.

## How we use your data

| Purpose                               | Data used                                      | Legal basis                               |
| ------------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| Provide the review management service | Account info, Google reviews, authored content | Performance of the beta agreement         |
| Maintain security and prevent abuse   | IP address, session data, audit logs           | Legitimate interest (security)            |
| Debug and improve the Service         | Error reports (no PII), performance metrics    | Legitimate interest (product improvement) |
| Comply with legal obligations         | Audit logs, Google access records              | Legal obligation                          |

## Data retention

| Data type                          | Retention period                          |
| ---------------------------------- | ----------------------------------------- |
| User account                       | Until account deletion is requested       |
| Google review content              | 30 days from initial fetch (ADR 0031)     |
| Reply drafts and published replies | Property lifetime                         |
| Inbox notes                        | Property lifetime                         |
| Audit logs                         | 90 days                                   |
| Session data                       | 30 days (session expiry)                  |
| Notification records               | 90 days                                   |
| Outbox event records               | 30 days                                   |
| Sync run history                   | 30 days                                   |
| Guest IP hashes                    | 90 days (when guest features are enabled) |

After the retention period, data is automatically deleted or anonymized.

## Data sharing and subprocessors

We use the following third-party services to operate the Service:

| Provider                               | Purpose             | Data they access                                                      | Region    |
| -------------------------------------- | ------------------- | --------------------------------------------------------------------- | --------- |
| **Neon** (Neon Labs, Inc.)             | Database hosting    | All application data (encrypted at rest)                              | US        |
| **Resend** (Resend, Inc.)              | Transactional email | Email address (for verification only)                                 | US        |
| **Amazon Web Services**                | Object storage      | Uploaded images (when portal uploads are enabled)                     | EU-West-3 |
| **Sentry** (Functional Software, Inc.) | Error monitoring    | Error stack traces and request metadata — **no PII** by configuration | US        |

Google Business Profile is a data source, not a subprocessor: the Service reads review data you have authorized via OAuth and publishes replies you have approved. Google's [API terms](https://developers.google.com/terms/api-services-user-data-policy) apply to this data.

We do not sell personal data. We do not use personal data for advertising. We do not train AI models on review content.

## Your rights

You have the right to:

- **Access** your personal data.
- **Correct** inaccurate personal data.
- **Delete** your account and associated personal data.
- **Export** your data in a machine-readable format.
- **Object** to processing based on legitimate interest.
- **Withdraw Google access** at any time, which purges cached review content.

To exercise these rights, contact **Bozhidar Denev**. We respond within 30 days.

## Security measures

- OAuth tokens encrypted with AES-256-GCM at rest.
- All HTTP traffic secured with TLS (HSTS enforced in production).
- Content-Security-Policy: default-deny (no third-party scripts).
- Session cookies: httpOnly, secure, sameSite.
- Error responses redacted (no stack traces, database details, or PII exposed).
- Destructive tests structurally cannot reach production databases.
- Regular dependency vulnerability scanning (Dependabot).
- Backups: point-in-time recovery with ≤15-minute recovery point objective.

## International transfers

The internal beta operates in the US region. Data processed for EU properties (when enabled) will use a dedicated EU processing cell. Until then, all data is processed and stored in the US. AWS S3 storage is in the eu-west-3 region (Paris) for proximity to European properties.

## Changes to this notice

We will notify Participants of any material changes to this notice before they take effect.

## Contact

**Data protection contact:** Bozhidar Denev
**Security incident contact:** Bozhidar Denev

---

_This notice is a draft for the internal beta and has not been reviewed by legal counsel. It will be updated before any external beta or production launch._
