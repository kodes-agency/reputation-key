# Enabling Google push notifications for new reviews

Without this, the app learns about a new Google review only when the
`discover-new-reviews` sweep next polls that property — up to about six and a
quarter hours for a property that has been quiet: a six-hour interval, then the
next 15-minute sweep (see the backoff ladder in
`src/contexts/review/domain/discovery-backoff.ts`). With it,
Google pushes within seconds and the sweep becomes a reconciliation safety net
rather than the mechanism: while a property's last completed reconciliation is
under six hours old, the sweep skips its full snapshot and only dates the next
look (ADR 0055, note of 2026-10-21; `REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED`).
That skip applies only when `GBP_PUBSUB_TOPIC` is set.

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
| Subscription expiration   | **Never expire**                                              |
| Message retention         | **14 days**                                                   |

Two things worth getting right:

- **The audience string must match the app exactly.** The app verifies it against
  `GBP_PUBSUB_AUDIENCE`, defaulting to `https://reputationkey.app/webhooks/gbp`.
  It is an arbitrary identifier, not a URL that gets fetched — but a mismatch
  fails every push with a 401.
- **Exponential backoff, not immediate retry.** The webhook enqueues a sync job
  and returns; a retry storm against a transient failure would multiply provider
  calls.
- **Never expire, and keep messages for 14 days.** Pub/Sub deletes a
  subscription that has had no activity for 31 days by default, and a quiet
  location is exactly that. A deleted subscription drops every push with no
  error anywhere in the app. Fourteen days of retention lets Pub/Sub redeliver
  a backlog after an outage of the app's endpoint (its default is seven).
  `scripts/ops/gcp-pubsub-setup.sh` sets both when it creates the subscription
  and when it updates one that exists (`--expiration-period=never` and
  `--message-retention-duration=14d`).

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
| `GBP_PUBSUB_PUSH_SERVICE_ACCOUNT` | `gbp-push-caller@<PROJECT_ID>.iam.gserviceaccount.com` | Required for push delivery — see below                            |
| `GBP_PUBSUB_NOTIFICATION_TYPES`   | `NEW_REVIEW`                                           | Default. `NEW_REVIEW,UPDATED_REVIEW` also catches edits           |

Set these on **both** the web and worker services: the web process serves the
webhook, and the worker subscribes accounts — on import and in its daily
reconciliation.

Set a topic in **one** environment per set of GBP accounts. Google stores one
topic per account, so two environments connected to the same accounts with
different topics re-point each other on every import and every daily run.

`GBP_PUBSUB_PUSH_SERVICE_ACCOUNT` is required. The webhook accepts a push only
when its verified `email` claim is this account; a Google-issued OIDC token that
merely carries the right audience is not enough, and there is no unpinned mode.
With the topic set and this variable unset the app still boots, but the webhook
answers every push 503 (`GBP push delivery is not configured`) and logs
`GBP webhook is not configured for exact authenticated push delivery` at error,
Pub/Sub retries and backs off, and new reviews arrive on the discovery sweep
only.

## 6. Subscribe the accounts

Nothing to run. Two paths tell Google to publish, both through the same
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

No operator command subscribes an account. `pnpm ops gbp-subscribe` refuses
`--apply`: operator commands run without the Google provider runtime, so the
command cannot call Google. It still reports, from a host that can reach the app's database (not
from outside Railway's private network), which connections of one organization
the daily job would cover:

```bash
# lists the candidate connections and their statuses, calls Google zero times
pnpm ops gbp-subscribe --operator <your-user-id> --org <organization-id>
```

Restarting the worker does not bring the next daily run forward: a later boot
keeps the pending run.

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
2. Post a review on a connected test property whose account is subscribed. An
   account imported before the variables were set is subscribed by the next
   daily run (§6), up to 24 hours away, and nothing brings that run forward:
   until then its reviews arrive on the discovery sweep, not within seconds.
3. Within seconds: a `sync-property-reviews` job with initiator
   `webhook:gbp`, then the review row, the inbox item, and the notification.
4. `GET /api/health/metrics` → `syncPush.push.acceptedPushes24h` rises by one
   per Property holding the location, and the review is not counted in
   `sync.push_missed_24h`.
5. `review_sync_state.last_notification_at` for that property should be ~now, and
   `next_incremental_at` clamped back to the hot interval. The look that clamp
   buys usually skips the full snapshot, because the property was reconciled
   within the last six hours; the review is already in from the push.

If nothing arrives, in order of likelihood:

- Pub/Sub shows `url_4xx_error_400` on the subscription and the web log says
  `Webhook received malformed provider identifiers or payload` — the webhook
  does not accept the message shape. Google publishes
  `{"type":"NEW_REVIEW","location":"accounts/…/locations/…","review":"accounts/…/locations/…/reviews/…"}`
  with no attributes (captured 2026-09-29). Pub/Sub retries a rejected message
  until it is acknowledged, so fixing and deploying the webhook delivers it.
- Pub/Sub shows 5xx delivery failures on the subscription and the web log says
  `Webhook durable acceptance failed` — the failure is on the app's side (the
  database, the reference store, a defect, or Google's signing keys could not
  be read: the key endpoint was unreachable, timed out, or answered with
  something other than its key set), not in the message. It is reported to
  error monitoring, and Pub/Sub retries the message until it is acknowledged.
- Step 3 was skipped or the principal is misspelled — Google drops the publish
  silently. Check the topic's Permissions page.
- The subscription's audience does not match `GBP_PUBSUB_AUDIENCE` — the app
  returns 401 and Pub/Sub will show delivery failures on the subscription. A
  401 with `Webhook JWT verification failed` in the web log is always about
  the token (audience, signature, expiry, or a key id Google does not
  publish), never about reaching Google's keys.
- `GBP_PUBSUB_PUSH_SERVICE_ACCOUNT` does not match the subscription's service
  account — same 401.
- `GBP_PUBSUB_PUSH_SERVICE_ACCOUNT` (or the topic) is not set on the web
  service — the app returns 503 to every push and the web log says
  `GBP webhook is not configured for exact authenticated push delivery`.
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

## 8. Watch push health

Push fails silently: Google stops publishing, the subscription expires, the
endpoint answers an error, and the only symptom is a review that takes six hours
instead of seconds. Two layers watch it: the app, and Google Cloud Monitoring.

**In the app (nothing to set up).** The app records, for each new review it
finds, how it was first seen and when Pub/Sub accepted the push for it
(`review_first_sightings`, ADR 0055 note of 2026-10-21), and reports counts
under `syncPush` in `GET /api/health/metrics`:

| Metric                                                                | Meaning                                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `sync.push_new_by_push_24h` / `sync.push_new_by_poll_24h`             | New reviews of the last day first seen through push, and through polling                                              |
| `sync.push_missed_24h`                                                | Found by polling with no push accepted within 60 minutes of being seen                                                |
| `sync.push_late_24h`                                                  | Found by polling before the push was accepted (any delay)                                                             |
| `sync.push_accepted_24h`                                              | Pushes Pub/Sub accepted, one per Property that holds the location                                                     |
| `sync.push_locations_healthy` / `_suspect`, `sync.push_accounts_dark` | The last 7 days: a location is suspect after one missed push, a Google account is dark after two across its locations |
| `sync.reconciliation_overdue`                                         | Properties with no completed reconciliation inside 8 hours                                                            |

They raise `sync.push-missed` and `sync.push-silent` (P2, `runbooks.md` §4) and,
independent of push, `sync.reconciliation-age` (P2, `runbooks.md` §13). They
count nothing while `GBP_PUBSUB_TOPIC` is empty.

**In Google Cloud Monitoring (owner console steps, not scripted).** The app can
only see pushes that reach it. These two policies see the ones that do not, and
catch a failing endpoint before the next review is missed. In **Monitoring →
Alerting → Create policy**, on the project that owns the subscription:

1. **Push delivery errors.** Metric `pubsub.googleapis.com/subscription/push_request_count`,
   filtered to `subscription_id = gbp-notifications-push` and a `response_code`
   that is not 2xx (the metric's response labels also separate `ack` from the
   error classes). Condition: any such requests over 10 minutes.
2. **Backlog.** Metric `pubsub.googleapis.com/subscription/oldest_unacked_message_age_by_region`
   (the older `.../oldest_unacked_message_age` also works), same subscription.
   Condition: above 30 minutes for 10 minutes. A healthy push subscription acks
   within seconds, so a backlog means the endpoint is down or rejecting.

Notify the owner's usual channel. These metric names and labels come from
Google's Pub/Sub monitoring reference, not from this repository: confirm both in
the console's metric picker when creating the policies, and adjust the response
filter to the labels it shows.

**Checking the subscription itself.** Once a quarter, and after any change to the
topic or the endpoint: **Pub/Sub → Subscriptions → `gbp-notifications-push`**
should show _Expiration: Never_ and _Message retention: 14 days_. A subscription
that Google has expired is not recreated by the app; re-run
`scripts/ops/gcp-pubsub-setup.sh` (§4) and confirm `sync.push_accepted_24h` rises
after the next review.

## What this does not change

Push is an accelerator, not a dependency. With it off, the discovery sweep still
finds new reviews within its ladder interval, because the skip rule is off too.
With it on, the sweep still runs as reconciliation, at least every six hours per
property, because push is not guaranteed delivery: a review whose push is missed
is found at the next reconciliation, up to about six hours later. That miss is
now measured, not assumed (§8: `sync.push-missed`, `sync.push-silent`), and
`sync.oldest_due_age_ms` and `sync.reconciliation-age` alert if the sweep itself
falls behind (`runbooks.md` §13).

Outbound **email** is separately gated. `notification.send_email` is a
capability-dark, per-tenant allowlist, and the sending domain still needs
verifying in Resend — see `EMAIL_FROM` in `.env.example`. Push does not affect
either.
