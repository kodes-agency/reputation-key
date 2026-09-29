# Enabling Google push notifications for new reviews

Without this, the app learns about a new Google review only when the
`discover-new-reviews` sweep next polls that property — up to 6 hours for a
property that has been quiet (see the backoff ladder in
`src/contexts/review/infrastructure/jobs/discover-new-reviews.job.ts`). With it,
Google pushes within seconds and the sweep becomes a reconciliation safety net
rather than the mechanism.

Everything on the app side is already built. This document is the Google Cloud
work plus the four environment variables that switch it on; once they are set,
the worker subscribes the accounts by itself (step 6).

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
webhook, and the worker subscribes accounts — on import and in its daily
reconciliation.

Set a topic in **one** environment per set of GBP accounts. Google stores one
topic per account, so two environments connected to the same accounts with
different topics re-point each other on every import and every daily run.

Leaving `GBP_PUBSUB_PUSH_SERVICE_ACCOUNT` unset is accepted, and the webhook logs
a warning once per process saying the pushing identity is unpinned. Unpinned
means _any_ Google-issued OIDC token carrying the right audience is accepted, not
only your subscription's. Set it.

## 6. Subscribe the accounts

Nothing to run. Three paths tell Google to publish, all through the same
`subscribe` use case
(`src/contexts/integration/application/use-cases/manage-notifications.ts`):

1. **On import.** Each imported property subscribes its connection's accounts
   as soon as the import item completes.
2. **Daily, in the worker.** The `reconcile-gbp-notification-subscriptions` job
   re-asserts the subscription of every account bound to an `active`
   connection, for every organization that current policy allows
   `property.connect_gbp` (a `degraded` connection is taken once it is active
   again). This is what repairs accounts imported while push
   was off or broken, and what follows a changed `GBP_PUBSUB_TOPIC`. It is an
   interval scheduler with no offset, so it **first runs right after the worker
   boots on the deploy that installs it**, then every 24 hours from that moment.
   It does nothing when `GBP_PUBSUB_TOPIC` is empty.
3. **On demand**, from a host that can reach the app's database (not from
   outside Railway's private network):

   ```bash
   # dry run: lists the candidate connections and their statuses, calls Google zero times
   pnpm ops gbp-subscribe --operator <your-user-id> --org <organization-id>

   # execute
   pnpm ops gbp-subscribe --operator <your-user-id> --org <organization-id> \
     --reason "enable GBP push" --apply
   ```

   `--apply` requires `--reason`; the reason lands in the operator audit trail
   with the actor and the decision.

**Which accounts.** Notification settings are per **Google Business Profile
account**, not per location, and RepKey touches an account only through a
Property actively bound to it. For each connection, `subscribe` reads every
active Property binding and targets the exact `gbpAccountId` of each distinct
account once (through the first of its Properties, in id order, that
authorizes, under that Property's authorization). A connection with properties under three accounts subscribes
all three; an org with one account and 30 properties subscribes once. Accounts
the connection can see but no Property is bound to are never touched, and a
connection with no bound Property yet has nothing to subscribe.

**Idempotent.** For each account, `subscribe` reads the current
`notificationSetting` first and PATCHes (`accounts.updateNotificationSetting`)
only when the topic or notification types differ, then reads it back to confirm.
An account already publishing to the topic costs one read and no write, and is
reported `already_subscribed`.

**What each run reports.** The daily job logs one content-free line per run
(counts and codes, no identifiers):

```
GBP notification subscriptions reconciled
  { job, organizations, organizationsDenied, organizationsFailed,
    organizationsDeferred, connections, candidates, connectionOutcomes,
    unsettledConnections, accountsSubscribed, accountsAlreadySubscribed,
    accountsFailed, failureCodes }
```

It logs at `info` when every account publishes, and at `warn` when an account
failed, a connection ended unsettled (for example `authorization_unavailable`),
an organization's backfill threw, or organizations were left for the next run.
`failureCodes` names why an account failed. Some codes mean our own execution
admission refused before Google: `coordination_unavailable`,
`authorization_changed`, `quota_exhausted`, and `authorization_denied` (no
Property of the connection could authorize that account). Others come from
Google: `provider_403`, `provider_5xx`, and `upstream_error`. A transient
failure fails the run after logging, and the queue retries it: 5 attempts,
backing off from 60 seconds, about a quarter of an hour in all. Transient means
a coordination or quota refusal, a permit fenced at start
(`authorization_changed`), a transport error, a 429 or 5xx, or an organization
whose backfill threw. A lasting refusal, such as a 403 or a denied binding,
waits for the next day's run. With no topic set, the job logs
`GBP notification subscription reconciliation skipped — no Pub/Sub topic
configured`.

Each Google call also leaves a row in `authorization_execution_permits`:
`capability = 'property.connect_gbp'`, `operation_key` one of
`provider.notifications.get` / `provider.notifications.subscribe`, ending
`state = 'completed'` with `correlation_id = 'success'` when Google accepted it
(`provider_4xx` / `provider_5xx` when Google refused). A `fenced` row names the
refusal in `correlation_id`, e.g. `authorization_changed`.

## 7. Verify

1. `GET /api/health/metrics` → `sync.gbp_push_enabled` should be `1`.
2. Post a review on a connected test property.
3. Within seconds: a `sync-property-reviews` job with initiator
   `webhook:gbp`, then the review row, the inbox item, and the notification.
4. `review_sync_state.last_notification_at` for that property should be ~now, and
   `next_incremental_at` clamped back to the hot interval.

If nothing arrives, in order of likelihood:

- Pub/Sub shows `url_4xx_error_400` on the subscription and the web log says
  `Webhook received malformed provider identifiers or payload` — the webhook
  does not accept the message shape. Google publishes
  `{"type":"NEW_REVIEW","location":"accounts/…/locations/…","review":"accounts/…/locations/…/reviews/…"}`
  with no attributes (captured 2026-09-29). Pub/Sub retries a rejected message
  until it is acknowledged, so fixing and deploying the webhook delivers it.
- Step 3 was skipped or the principal is misspelled — Google drops the publish
  silently. Check the topic's Permissions page.
- The subscription's audience does not match `GBP_PUBSUB_AUDIENCE` — the app
  returns 401 and Pub/Sub will show delivery failures on the subscription.
- `GBP_PUBSUB_PUSH_SERVICE_ACCOUNT` does not match the subscription's service
  account — same 401.
- Google was never told to publish for that account. Look for the daily
  `GBP notification subscriptions reconciled` line, or the per-account
  `GBP notifications subscribe failed — continuing` warning with its `code`:
  - `coordination_unavailable` — our own execution admission refused before
    any request, logged as `Google admission denied` with
    `stage: admission-start`. Either the provider-coordination Redis was
    unreachable, or the route has no quota policy: until 2026-09-29 the
    notification routes had none (`google-notifications-read-v1` /
    `-write-v1`), so every subscribe was refused this way and the permits
    ended `fenced`.
  - `authorization_changed` — the permit was fenced at start. Either the
    connection, Property binding or credential generation moved, or the
    database does not yet admit the notification principal in
    `start_google_execution_permit`. Migration
    `0039_google_notification_permit_start` adds that, and it runs in the
    web service's pre-deploy, so deploy web before the worker. If the worker
    ran first, the daily job retries for about a quarter of an hour.
  - `provider_403` — Google refused: check that the My Business Notifications
    API is enabled on the OAuth client's project (step 1).
  - Nothing at all — the connection has no active bound Property, or the
    organization is not allowed `property.connect_gbp` (`organizationsDenied`).

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
