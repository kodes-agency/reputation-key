# Google Business Profile Access Disclosure

**Status:** Draft — pending legal review
**Date:** 2026-07-14
**Accountable owner:** Bozhidar Denev

## Overview

This document discloses how Reputation Key accesses and uses Google Business Profile data during the internal beta, in accordance with Google's [API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) and the [written response](../product-readiness-program-2026-07/google-business-profile-ai-policy-response-2026-07-14.md) received from Google on 2026-07-14.

## OAuth scopes requested

| Scope                   | Purpose                                       | Data accessed                                    |
| ----------------------- | --------------------------------------------- | ------------------------------------------------ |
| `business.manage`       | Manage reviews, locations, and reply settings | Review data, location metadata, reply publishing |
| (narrower if available) | Read-only review access for shadow sync       | Review data only                                 |

The Service requests the minimum scopes required for the beta features. Scope reduction will be applied as Google provides granular review-only scopes.

## How Google data is used

### Permitted uses (beta)

1. **Review synchronization**: Fetch reviews from connected Google Business Profile locations to populate the triage inbox.
2. **Reply publishing**: Publish human-authored, human-approved replies to Google reviews.
3. **Status tracking**: Track whether reviews have been replied to and the publication status.
4. **Derived metrics**: Compute rating averages, response times, review volume, and trends — all as property-local aggregates, never combining across properties.
5. **Webhook notifications**: Receive Google Pub/Sub notifications for new reviews (if configured).

### Permitted uses (future, conditionally approved per Google response)

6. **Per-property AI analysis**: Sentiment classification, theme detection, priority scoring — stored as derivative metadata without raw content, only when merchant opt-in and all ADR 0031 controls are active.
7. **Reply drafting assistance**: AI-generated reply suggestions for manager review — never auto-published.

### Prohibited uses (per Google response)

8. **Automated reply publishing**: AI-drafted replies are never published without explicit human approval.
9. **Cross-property summarization**: Reviews from different properties are never combined in AI analysis or reporting.
10. **Review solicitation gamification**: Review counts, ratings, or scan events never drive goals, badges, or leaderboard rankings.
11. **Provider training**: Review content is never submitted to AI providers that may use it for model training.
12. **Minimum retention violation**: Review content is never retained beyond 30 days without a successful re-fetch from Google.

## Data retention and deletion

| Data                   | Retention                                       | Deletion mechanism                   |
| ---------------------- | ----------------------------------------------- | ------------------------------------ |
| Raw review text        | 30 days from fetch                              | TTL purge job (`content_expires_at`) |
| Reviewer name          | 30 days from fetch                              | TTL purge job                        |
| Reviewer profile photo | 30 days from fetch                              | TTL purge job                        |
| Rating (integer)       | Retained (not personal data)                    | Property archive/purge               |
| Google review ID       | Retained (identifier for sync)                  | Property archive/purge               |
| Published reply text   | Retained (user-authored, also stored by Google) | Property archive/purge               |
| OAuth tokens           | Until disconnection                             | Connection disconnect purges tokens  |
| GBP API cache          | `expires_at` per Google cache-control           | Automatic expiry                     |

On disconnect:

1. OAuth refresh token is revoked and deleted.
2. Cached review content is purged within 24 hours.
3. Derived metrics are retained for 90 days for operational continuity.
4. Audit records of the disconnection are retained for 90 days.

## Data security

- OAuth tokens encrypted with AES-256-GCM before storage.
- Google API calls made over HTTPS.
- Review content never included in outbox event payloads (ADR 0030 — identifier-only).
- Error logs redact review text, reviewer names, and Google identifiers.
- Sentry error monitoring configured to exclude PII fields.
- Database backups contain review content but TTL purge runs on restore.

## Incident response

If a Google API security incident is detected (token leak, unauthorized access, data exposure):

1. **Immediate**: Revoke the affected OAuth tokens via Google API.
2. **Within 1 hour**: Notify Bozhidar Denev (security contact).
3. **Within 24 hours**: Assess scope, purge affected cached content, document the incident.
4. **Within 72 hours**: Notify affected property owners and Google if required by API terms.

## Google's written response

Google's 2026-07-14 response conditionally permits:

- Per-property AI analysis (sentiment, themes, priority) — with merchant opt-in, PII redaction, no-training, minimum retention.
- AI-generated reply drafts — with separate manager-controlled publication command.
- Property-local trend detection — never cross-property.

The response explicitly does not permit:

- Automated AI reply publishing.
- Cross-property AI summarization.
- Review solicitation gamification tied to Google review data.

Full response: [`google-business-profile-ai-policy-response-2026-07-14.md`](../product-readiness-program-2026-07/google-business-business-profile-ai-policy-response-2026-07-14.md)

---

_This disclosure is a draft for the internal beta and has not been reviewed by legal counsel._
