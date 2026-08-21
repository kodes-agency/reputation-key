# Enabling Google push notifications for new reviews

Without this, the app learns about a new Google review only when the
`discover-new-reviews` sweep next polls that property — up to 6 hours for a
property that has been quiet (see the backoff ladder in
`src/contexts/review/infrastructure/jobs/discover-new-reviews.job.ts`). With it,
Google pushes within seconds and the sweep becomes a reconciliation safety net
rather than the mechanism.

Everything on the app side is already built. This document is the Google Cloud
work plus the four environment variables that switch it on.

## What you need before starting

- The **Google Cloud project** that owns your Business Profile OAuth client.
- **Owner** or **Pub/Sub Admin** + **Service Account Admin** on that project.
- Your Business Profile API access already approved. Push notifications use the
  same `https://www.googleapis.com/auth/business.manage` scope the app already
  requests, so there is **no new scope and no re-consent** for connected users.
- A publicly reachable HTTPS deployment. Pub/Sub does **not** require domain
  ownership verification for push endpoints, but the endpoint must present a
  valid certificate.

## 1. Enable the APIs

In **APIs & Services → Library**, enable:

| API                               | Why                                                                        |
| --------------------------------- | -------------------------------------------------------------------------- |
| **My Business Notifications API** | `accounts.updateNotificationSetting` — how we tell Google where to publish |
| **Cloud Pub/Sub API**             | the topic and subscription themselves                                      |

The other Business Profile APIs (Account Management, Business Information,
Business Profile Performance, and the allowlisted My Business API v4 used for
reviews) should already be enabled; if reviews import today, they are.

## 2. Create the topic

**Pub/Sub → Topics → Create topic**. Any ID; `gbp-notifications` is a reasonable
choice. Leave "Add a default subscription" **unchecked** — step 4 creates the
subscription with authentication, which the default one lacks.

Note the full resource name, which is what the app needs:

```
projects/<PROJECT_ID>/topics/gbp-notifications
```

## 3. Let Google publish to it

This is the step that is easy to miss and produces no error until a review
arrives and nothing happens.

On the topic → **Permissions** → **Add principal**:

- **Principal:** `mybusiness-api-pubsub@system.gserviceaccount.com`
- **Role:** `Pub/Sub Publisher` (`roles/pubsub.publisher`)

That address is Google's own system account for Business Profile notifications.
It is the same for every project — you are granting Google permission to publish
into your topic.

## 4. Create the push subscription

First create the identity the push requests will be signed as:

**IAM & Admin → Service accounts → Create service account**, e.g.
`gbp-push-caller`. It needs **no project roles at all** — it exists only to be
the `email` claim in the OIDC token, which is what the app pins in step 6.

Then **Pub/Sub → Subscriptions → Create subscription**:

| Field                     | Value                                                         |
| ------------------------- | ------------------------------------------------------------- |
| Subscription ID           | `gbp-notifications-push`                                      |
| Topic                     | the topic from step 2                                         |
| Delivery type             | **Push**                                                      |
| Endpoint URL              | `https://<your-domain>/api/webhooks/gbp/notifications`        |
| **Enable authentication** | ✅ on                                                         |
| Service account           | `gbp-push-caller@<PROJECT_ID>.iam.gserviceaccount.com`        |
| **Audience**              | `https://reputationkey.app/webhooks/gbp`                      |
| Acknowledgement deadline  | 30 seconds                                                    |
| Retry policy              | **Retry after exponential backoff delay** (min 10s, max 600s) |

Two things worth getting right:

- **The audience string must match the app exactly.** The app verifies it against
  `GBP_PUBSUB_AUDIENCE`, defaulting to `https://reputationkey.app/webhooks/gbp`.
  It is an arbitrary identifier, not a URL that gets fetched — but a mismatch
  fails every push with a 401.
- **Exponential backoff, not immediate retry.** The webhook enqueues a sync job
  and returns; a retry storm against a transient failure would multiply provider
  calls.

If your project was created **on or before 8 April 2021**, also grant
`service-<PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com` the
**Service Account Token Creator** role (`roles/iam.serviceAccountTokenCreator`)
on the `gbp-push-caller` account, so Pub/Sub can mint the OIDC token. Newer
projects get this through `roles/pubsub.serviceAgent` automatically.

## 5. Point the app at the topic

| Variable                          | Value                                                  | Notes                                                             |
| --------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `GBP_PUBSUB_TOPIC`                | `projects/<PROJECT_ID>/topics/gbp-notifications`       | Empty (the default) means push is disabled and `subscribe` no-ops |
| `GBP_PUBSUB_AUDIENCE`             | `https://reputationkey.app/webhooks/gbp`               | Must equal the subscription's audience                            |
| `GBP_PUBSUB_PUSH_SERVICE_ACCOUNT` | `gbp-push-caller@<PROJECT_ID>.iam.gserviceaccount.com` | Optional but recommended — see below                              |
| `GBP_PUBSUB_NOTIFICATION_TYPES`   | `NEW_REVIEW`                                           | Default. `NEW_REVIEW,UPDATED_REVIEW` also catches edits           |

Set these on **both** the web and worker services: the web process serves the
webhook, the worker subscribes on import.

Leaving `GBP_PUBSUB_PUSH_SERVICE_ACCOUNT` unset is accepted, and the webhook logs
a warning once per process saying the pushing identity is unpinned. Unpinned
means _any_ Google-issued OIDC token carrying the right audience is accepted, not
only your subscription's. Set it.

## 6. Subscribe the accounts

Newly connected properties subscribe automatically. Connections made before that
wiring existed never told Google to publish, so they need a one-off backfill —
**per organisation**, since the command is org-scoped:

```bash
# dry run: lists the candidate connections and their statuses, calls Google zero times
pnpm ops:gbp-subscribe --operator <your-user-id> --org <organization-id>

# execute
pnpm ops:gbp-subscribe --operator <your-user-id> --org <organization-id> \
  --reason "enable GBP push" --apply
```

`--apply` requires `--reason`; the reason lands in the operator audit trail with
the actor and the decision. Run the dry form first — it is the cheapest way to
confirm the org has the connections you expect before touching the provider.

Re-runnable and idempotent: `accounts.updateNotificationSetting` is a PATCH of a
single per-account resource, so re-asserting the same topic is a no-op.

**Two scope limits worth knowing before you rely on it.**

Notification settings are per **Google account**, not per location. One call
covers every location under that account, so an org with one GBP account and 30
properties subscribes once.

And the subscribe path resolves the account by calling `listAccounts` and taking
the **first** result. A connection whose token grants access to more than one GBP
account will only have its first account subscribed; locations under the others
keep arriving via the discovery sweep. If you have such a tenant, that is a
genuine gap rather than a configuration mistake — check
`review_sync_state.last_notification_at` per property to see which are actually
receiving push.

**If you ever change `GBP_PUBSUB_TOPIC`, run this again for every org.** Existing
subscriptions keep pointing at the old topic; nothing re-points them
automatically, and the symptom is silence rather than an error.

## 7. Verify

1. `GET /api/health/metrics` → `sync.gbp_push_enabled` should be `1`.
2. Post a review on a connected test property.
3. Within seconds: a `sync-property-reviews` job with initiator
   `webhook:gbp`, then the review row, the inbox item, and the notification.
4. `review_sync_state.last_notification_at` for that property should be ~now, and
   `next_incremental_at` clamped back to the hot interval.

If nothing arrives, in order of likelihood:

- Step 3 was skipped or the principal is misspelled — Google drops the publish
  silently. Check the topic's Permissions page.
- The subscription's audience does not match `GBP_PUBSUB_AUDIENCE` — the app
  returns 401 and Pub/Sub will show delivery failures on the subscription.
- `GBP_PUBSUB_PUSH_SERVICE_ACCOUNT` does not match the subscription's service
  account — same 401.
- Step 6 was never run for that account, so Google was never told to publish.

## What this does not change

Push is an accelerator, not a dependency. With it off, the discovery sweep still
finds new reviews within its ladder interval. With it on, the sweep still runs as
reconciliation, because push is not guaranteed delivery — and
`sync.oldest_due_age_ms` alerts if the sweep itself falls behind
(`runbooks.md` §13).

Outbound **email** is separately gated. `notification.send_email` is a
capability-dark, per-tenant allowlist, and the sending domain still needs
verifying in Resend — see `EMAIL_FROM` in `.env.example`. Push does not affect
either.
