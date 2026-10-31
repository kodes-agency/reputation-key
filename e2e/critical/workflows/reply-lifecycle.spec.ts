// BQC-6.5 item 6 — manual reply draft/edit/approve/publish with success,
// transient failure, terminal rejection, and ambiguous reconciliation.
//
// All four scenarios run the REAL chain: web server fns (synchronous
// lifecycle) → BullMQ publish-reply job in the worker → the real GBP reply
// adapter against the stub's scripted provider modes. Scenario (a) drives the
// reply UX in the inbox detail panel; (b)-(d) use RPC for setup and assert
// durable state + stub-recorded provider calls.
//
//   (a) draft → edit → submit → approve → published (stub records the upsert)
//   (b) approve → uncertain 500 → the send waits inside its propagation grace
//       (still sending); "Check Google again" is read-only, "Try publishing
//       again" is refused, and no second provider write is issued
//   (c) approve → terminal 403 → publish_failed/terminal; a fresh, safe retry
//       is rejected again by the provider
//   (d) ambiguous publication + provider shows the reply → pressing "Check
//       Google again" in the inbox heals to published, says so, and issues
//       ZERO re-sends
//   (e) someone replied on Google after the last sync → the worker reads the
//       review before it claims, sees the reply RepKey had not recorded, ends
//       the cycle (cancelled, provider_truth) and issues ZERO writes

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { clickWhenReady, dismissToasts } from '../../helpers/interaction'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl, type StubReview } from '../../fixtures/gbp-stub'
import {
  dbQuery,
  drainFixtureQueue,
  enqueueReviewSync,
  e2eRunId,
  cleanupE2eData,
  seedGoogleConnection,
  seedProperty,
  seedAmbiguousReply,
  getUserByEmail,
  getReplyForReview,
  getInboxItemForReview,
  callServerFn,
  callServerFnGet,
  callServerFnExpectError,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-rep-'
const seed = requireE2eSeedState()
const ACCOUNT = `e2e-rep-${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
// Run-scoped: this spec's Property survives cleanup (its Reply is named by an
// immutable reply_publication_authorization), so a fixed location id would
// collide with the surviving row on properties_org_gbp_location_id_unique.
const locationId = (name: string) => `${name}-loc-${e2eRunId}`

const REPLY_FILE = 'src/contexts/review/server/reply-draft.ts'
const REPLY_FILE_OPS = 'src/contexts/review/server/reply.ts'

type Scenario = Readonly<{
  connectionId: string
  propertyId: string
  reviewId: string
  inboxItemId: string
  locationName: string
  reviewName: string
}>

type ProviderScenario = Readonly<{
  reviews: StubReview[]
  replyBehavior?: Parameters<typeof gbpStubControl.putScope>[0]['replyBehavior']
}>

test.describe('Critical workflow: reply lifecycle', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async () => {
    // Stale provider syncs from an earlier spec retry against a stub scope that
    // has moved on, and burn the shared reviews quota this one needs.
    await drainFixtureQueue()
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  /** What Google serves for one scenario. Putting it again replaces it. */
  async function putScenarioScope(name: string, opts: ProviderScenario): Promise<void> {
    const locationName = `${ACCOUNT_NAME}/locations/${locationId(name)}`
    await gbpStubControl.putScope({
      account: {
        name: ACCOUNT_NAME,
        accountName: `E2E reply account ${e2eRunId}`,
        role: 'OWNER',
      },
      locations: [
        {
          name: locationName,
          title: `E2E Reply Hotel ${name} ${e2eRunId}`,
          storefrontAddress: { regionCode: 'US' },
        },
      ],
      reviews: { [locationName]: opts.reviews },
      replyBehavior: opts.replyBehavior,
    })
  }

  /** Isolated provider + data landscape for one scenario. */
  async function setupScenario(name: string, opts: ProviderScenario): Promise<Scenario> {
    const locationName = `${ACCOUNT_NAME}/locations/${locationId(name)}`
    const reviewName = `${locationName}/reviews/${name}-r1-${e2eRunId}`
    await putScenarioScope(name, opts)
    const admin = await getUserByEmail(seed.email)
    const { connectionId } = await seedGoogleConnection({
      organizationId: seed.organizationId,
      connectedBy: admin!.id,
      googleSubject: ACCOUNT,
    })
    const { propertyId } = await seedProperty({
      organizationId: seed.organizationId,
      name: `E2E Reply Hotel ${name} ${e2eRunId}`,
      slug: `${PREFIX}${name}-${e2eRunId}`,
      googleBinding: {
        connectionId,
        accountId: ACCOUNT,
        locationId: locationId(name),
      },
    })
    // GBP does not expose a review language. Configure the Property's supported
    // manual-reply language so the real imported review can be drafted.
    await dbQuery(
      `UPDATE properties
       SET default_reply_language = 'en-Latn', updated_at = now()
       WHERE organization_id = $1 AND id = $2::uuid`,
      [seed.organizationId, propertyId],
    )
    await enqueueReviewSync({
      propertyId,
      organizationId: seed.organizationId,
      connectionId,
      locationName,
    })
    const arrivedReview = await waitFor(
      async () => {
        const [review] = await dbQuery<{ id: string }>(
          'SELECT id FROM reviews WHERE organization_id = $1 AND property_id = $2::uuid AND external_id = $3',
          [seed.organizationId, propertyId, `${name}-r1-${e2eRunId}`],
        )
        return review ?? null
      },
      { timeoutMs: 30_000, description: `arrived review ${name}` },
    )
    const reviewId = arrivedReview.id
    const inboxItem = await waitFor(() => getInboxItemForReview(reviewId), {
      timeoutMs: 15_000,
      description: `inbox item for arrived review ${name}`,
    })
    const inboxItemId = inboxItem.id as string
    return { connectionId, propertyId, reviewId, inboxItemId, locationName, reviewName }
  }

  const stubReview = (name: string): StubReview => ({
    name: `${ACCOUNT_NAME}/locations/${locationId(name)}/reviews/${name}-r1-${e2eRunId}`,
    starRating: 'FIVE',
    comment: `Reply scenario ${name} review body`,
    reviewer: { displayName: `Reply Reviewer ${name}` },
    createTime: '2026-07-27T12:00:00Z',
  })

  for (const width of [1280, 390]) {
    test(`(g) v2 background draft → reveal → adopt → submit at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(90_000)
      const name = `stream-${width}`
      const s = await setupScenario(name, {
        reviews: [
          {
            ...stubReview(name),
            comment:
              'Check-in took forty minutes and nobody apologised. The room smelled of smoke. The pool area was lovely though.',
          },
        ],
      })
      const admin = await getUserByEmail(seed.email)
      await dbQuery(
        `INSERT INTO property_portal_brand_profiles (id, organization_id, property_id, display_name, primary_color, background_color, text_color, updated_by) VALUES (gen_random_uuid(), $1, $2::uuid, 'Seabreeze Hotel', '#5b3fd0', '#ffffff', '#111111', $3) ON CONFLICT (organization_id, property_id) DO NOTHING`,
        [seed.organizationId, s.propertyId, admin!.id],
      )
      const previous = await dbQuery<{
        scope_key: string
        execution_state: string
        admission_state: string
      }>(
        `SELECT scope_key, execution_state, admission_state FROM ai_execution_control_heads WHERE scope_key = ANY($1::text[])`,
        [['global', 'provider:private-beta-global-v3', 'capability:reply_drafting']],
      )
      const posture = async (scope: string, execution: string, admission: string) => {
        await dbQuery(
          `WITH head AS (SELECT * FROM ai_execution_control_heads WHERE scope_key = $1 FOR UPDATE), transition AS (INSERT INTO ai_execution_control_transitions (control_id, generation, predecessor_generation, scope_key, scope_kind, scope_value, execution_state, admission_state, reason_code, actor_user_id, occurred_at, ticket_reference) SELECT control_id, generation + 1, generation, scope_key, scope_kind, scope_value, $2, $3, 'e2e_release', NULL, now(), 'PR-B3b' FROM head RETURNING generation) UPDATE ai_execution_control_heads SET generation = transition.generation, execution_state = $2, admission_state = $3, updated_at = now() FROM transition WHERE scope_key = $1`,
          [scope, execution, admission],
        )
      }
      try {
        for (const control of previous)
          await posture(control.scope_key, 'enabled', 'accepting')
        const armed = await fetch('http://127.0.0.1:4102/__control/arm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operationKind: 'reply',
            delayMillis: 2_000,
            parsed: {
              languageCode: 'en-Latn',
              case: 'complaint',
              mainPoint: [1, 2],
              avoidTerms: [],
              replyText:
                'We are sorry the long check-in and smoke in your room made the arrival uncomfortable. You should have been able to settle in promptly and comfortably.',
            },
          }),
        })
        expect(armed.ok).toBe(true)
        await page.setViewportSize({ width, height: 900 })
        await signIn(page)
        const identity = 'src/contexts/identity/server/merchant-ai.ts'
        const { notice } = await callServerFnGet<{
          notice: { version: string; digest: string }
        }>(page, {
          file: identity,
          exportName: 'getMerchantAiAuthorizationFn',
          data: { propertyId: s.propertyId },
        })
        await callServerFn(page, {
          file: identity,
          exportName: 'enableMerchantAiForPropertiesFn',
          data: {
            propertyIds: [s.propertyId],
            capabilities: ['reply_drafting'],
            acknowledgement: {
              noticeVersion: notice.version,
              noticeDigest: notice.digest,
            },
            idempotencyKey: `${name}-${e2eRunId}`,
          },
        })
        await dbQuery(
          `INSERT INTO ai_property_processing_profiles (organization_id, property_id, country_code, timezone, processing_region, routing_policy_version, provider_deployment_profile_version, source_epoch, profile_version, lifecycle_state, updated_at) SELECT organization_id, id, country_code, timezone, 'global', 1, 'private-beta-global-v2', source_epoch, 1, 'active', now() FROM properties WHERE id = $1::uuid ON CONFLICT DO NOTHING`,
          [s.propertyId],
        )
        await page.goto(`/inbox?itemId=${s.inboxItemId}`)
        await waitFor(
          async () =>
            (
              await dbQuery<{ id: string }>(
                `SELECT id FROM ai_operations WHERE review_id = $1::uuid AND operation_profile_version = 'reply-suggestion-v2' AND state = 'executing'`,
                [s.reviewId],
              )
            )[0] ?? null,
          { timeoutMs: 20_000, description: 'hidden background stream executing' },
        )
        await expect(page.getByRole('region', { name: 'Draft suggestion' })).toHaveCount(
          0,
        )
        // A phone opens on the "Reply…" bar. The draft is held above the
        // composer, so opening it joins the running draft instead of starting one.
        if (width < 768)
          await page.getByRole('button', { name: 'Reply…', exact: true }).click()
        await page.getByRole('button', { name: 'Draft with AI', exact: true }).click()
        await expect(
          page.getByRole('button', { name: 'Stop', exact: true }),
        ).toBeVisible()
        await expect(page.getByRole('textbox', { name: 'Public reply' })).toBeEnabled()
        await expect(
          page.getByRole('button', { name: 'Choose a reply template' }),
        ).toBeEnabled()
        await expect(
          page.getByText('Personalized AI suggestion', { exact: true }),
        ).toBeVisible({ timeout: 20_000 })
        await page.getByRole('button', { name: 'Use draft', exact: true }).click()
        await expect(page.getByRole('textbox', { name: 'Public reply' })).toHaveValue(
          /long check-in/,
        )
        await expect(
          page.getByRole('button', { name: 'Shorter', exact: true }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Tone', exact: true }),
        ).toBeVisible()
        const frame = await dbQuery<{ prefix: number; suffix: number }>(
          `SELECT (voice_choices->>'bodyPrefixLength')::integer AS prefix, (voice_choices->>'bodySuffixLength')::integer AS suffix FROM replies WHERE review_id = $1::uuid AND source = 'internal'`,
          [s.reviewId],
        )
        expect(frame[0]!.prefix).toBeGreaterThan(0)
        expect(frame[0]!.suffix).toBeGreaterThan(0)
        await page.reload()
        await expect(
          page.getByRole('button', { name: 'Shorter', exact: true }),
        ).toBeVisible()
        await page
          .getByRole('button', { name: 'Submit for approval', exact: true })
          .click()
        await waitFor(
          async () => {
            const reply = await getReplyForReview(s.reviewId)
            return reply?.status === 'pending_approval' ? reply : null
          },
          { timeoutMs: 15_000, description: 'v2 draft adopted and submitted' },
        )
        const operations = await dbQuery<{
          operation_profile_version: string
          requests: number
        }>(
          `SELECT operation_profile_version, count(*)::integer AS requests FROM ai_operations WHERE review_id = $1::uuid GROUP BY operation_profile_version`,
          [s.reviewId],
        )
        expect(operations).toEqual([
          { operation_profile_version: 'reply-suggestion-v2', requests: 1 },
        ])
      } finally {
        for (const control of previous)
          await posture(
            control.scope_key,
            control.execution_state,
            control.admission_state,
          )
      }
    })
  }

  test('(a) draft → edit → submit → approve → published (UI-driven)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const s = await setupScenario('happy', { reviews: [stubReview('happy')] })
    await signIn(page)
    await page.goto(`/inbox?itemId=${s.inboxItemId}`)
    await expect(page.getByText('Reply Reviewer happy').first()).toBeVisible({
      timeout: 15_000,
    })

    // Draft. There is no Save button: the composer AUTOSAVES, so the draft is
    // proven by the row appearing, not by a click.
    await page.getByPlaceholder('Write a reply…').fill('First draft wording')
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'draft' ? reply : null
      },
      { timeoutMs: 15_000, description: 'reply draft autosaved' },
    )

    // Edit the draft — same autosave path.
    await page.getByPlaceholder('Write a reply…').fill('Final reply wording — thank you!')
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.text === 'Final reply wording — thank you!' ? reply : null
      },
      { timeoutMs: 15_000, description: 'edited draft autosaved' },
    )

    // The reply language lives in the assist menus now (plan v2.1 rows 17-18),
    // not in a select above the box or a repeated standalone control. Proven in the real app, on the
    // one choice that is load-bearing for a HAND-TYPED reply: GBP records no
    // review language, so `review language` here is `Detect automatically`,
    // which stops autosave and Submit until a language is chosen again. The
    // step picks it from `Draft with AI ▾` → `Write in`, asserts the menu trigger
    // and Submit say so, then returns to the property default through the same
    // menu before submitting. (No AI draft is generated: this spec
    // configures no AI provider for the property, so the result tag — which
    // only an adopted assist action prints — is covered in Storybook.)
    const submit = page.getByRole('button', { name: 'Submit for approval' })
    const unresolved =
      'This reply has no language yet. Choose a reply language to save and submit it.'
    await expect(
      page.getByRole('button', { name: 'AI tone and language: Professional, English' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /^Reply language:/ })).toHaveCount(0)
    await page
      .getByRole('button', { name: 'AI tone and language: Professional, English' })
      .click()
    await page
      .getByRole('group', { name: 'Write in' })
      .getByRole('menuitem', { name: 'Detect automatically' })
      .click()
    await expect(
      page.getByRole('button', {
        name: 'AI tone and language: Professional, Detect automatically',
      }),
    ).toBeVisible()
    await expect(submit).toBeDisabled()
    await expect(submit).toHaveAccessibleDescription(unresolved)
    await page
      .getByRole('button', {
        name: 'AI tone and language: Professional, Detect automatically',
      })
      .click()
    await page
      .getByRole('group', { name: 'Write in' })
      .getByRole('menuitem', { name: 'English · property default' })
      .click()
    await expect(
      page.getByRole('button', { name: 'AI tone and language: Professional, English' }),
    ).toBeVisible()
    await expect(submit).toBeEnabled()

    // Submit for approval.
    await submit.click()
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'pending_approval' ? reply : null
      },
      { timeoutMs: 10_000, description: 'reply pending approval' },
    )
    const awaitingApprovalQueue = page.getByRole('button', {
      name: /^Awaiting approval(?: \d+)?$/,
    })
    await expect(awaitingApprovalQueue).toBeVisible()

    // Submitting moves the item out of Needs reply, so the workspace closes
    // the detail instead of pinning an item that no longer belongs to its list.
    // Follow the same queue transition a manager does before approving it.
    await awaitingApprovalQueue.click()
    await page
      .getByRole('button', { name: /^Open review from Reply Reviewer happy/ })
      .click()

    // Approve → the publish job runs (worker) → published.
    // Approval is a two-step confirmation now: the trigger opens a dialog that
    // states what publishing does, and the dialog's own action is what commits.
    await page.getByRole('button', { name: 'Confirm & publish', exact: true }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm & publish', exact: true })
      .click()
    // Publication is TWO-PHASE. The publish job writes to Google and stops at
    // "write accepted; awaiting provider observation" -- the attempt sits at
    // provider_outcome_pending until a later read of the review sees the reply
    // and records the observation that confirms it. `review.reply.observed` is
    // the sole provider-reply authority; the write alone never claims success.
    // In production the scheduled sync does that read; here the spec asks for
    // it, rather than waiting on a schedule.
    // Waited on the ATTEMPT, not the reply status: the reply is already
    // 'approved' before the publish job runs, so waiting on that would race the
    // write and the read-back below would find nothing to observe.
    await waitFor(
      async () => {
        const [attempt] = await dbQuery<{ outcome: string }>(
          `SELECT outcome FROM reply_publication_attempts
           WHERE review_id = $1 ORDER BY attempt_number DESC LIMIT 1`,
          [s.reviewId],
        )
        return attempt && attempt.outcome !== 'sending' ? attempt : null
      },
      { timeoutMs: 25_000, description: 'provider write accepted' },
    )
    // Production confirms the write by READING the provider back on the sync
    // schedule, so the test drives that same poll rather than waiting on a
    // scheduler tuned for hours. ONE sync, deliberately: each additional
    // snapshot records another observation, and a newer observation head
    // makes the confirming one non-current — the Inbox close permit is
    // scoped to the exact current observation, so an over-eager poll races
    // the auto-close out of existence.
    await enqueueReviewSync({
      propertyId: s.propertyId,
      organizationId: seed.organizationId,
      connectionId: s.connectionId,
      locationName: s.locationName,
    })
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'published' ? reply : null
      },
      { timeoutMs: 60_000, description: 'reply confirmed published by observation' },
    )
    // The published badge, rendered from persisted state. Publishing
    // auto-closes the inbox item (inbox's reply-published handler), so the
    // detail opens from the Closed folder.
    // The auto-close is a SEPARATE durable consumer of the observation fact,
    // so it lands after the reply reports published — wait for it rather than
    // racing the Closed folder.
    await waitFor(
      async () => {
        const [item] = await dbQuery<{ status: string }>(
          `SELECT status FROM inbox_items WHERE id = $1::uuid`,
          [s.inboxItemId],
        )
        return item?.status === 'closed' ? item : null
      },
      { timeoutMs: 30_000, description: 'inbox item auto-closed by the observation' },
    )
    await page.goto(
      `/inbox?queue=replied&propertyId=${s.propertyId}&itemId=${s.inboxItemId}`,
    )
    // The chip names the PROVIDER-confirmed state, not the internal status:
    // 'published' here means Google's own read-back showed the reply.
    await expect(page.getByText('Live on Google').first()).toBeVisible({
      timeout: 15_000,
    })

    // The provider recorded exactly one reply upsert with the final wording.
    const puts = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${s.locationName}`,
    })
    expect(puts).toHaveLength(1)
    expect(puts[0].path).toContain(`/reviews/happy-r1-${e2eRunId}/reply`)
    expect(puts[0].body).toContain('Final reply wording — thank you!')

    // The worker read the review from Google before it wrote (a reply is an
    // upsert, so this is the only thing that sees an answer typed there).
    const readsOfTheReview = await gbpStubControl.calls({
      method: 'GET',
      pathPrefix: `/v4/${s.reviewName}`,
    })
    expect(readsOfTheReview.length).toBeGreaterThan(0)
    const firstRead = readsOfTheReview[0]
    const firstWrite = puts[0]
    expect(firstRead !== undefined && firstWrite !== undefined).toBe(true)
    expect(firstRead!.at <= firstWrite!.at).toBe(true)
  })

  test('(b) transient 500 stays an uncertain send that is only ever checked', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const s = await setupScenario('transient', {
      reviews: [stubReview('transient')],
      replyBehavior: { mode: 'fail-then-success', status: 500, failures: 1 },
    })
    await signIn(page)

    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'draftReplyFn',
      data: { reviewId: s.reviewId, text: 'Transient retry reply text' },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'submitReplyFn',
      data: { reviewId: s.reviewId },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'approveReplyFn',
      data: { reviewId: s.reviewId },
    })

    // A 500 is Google's answer, so the request reached Google and its outcome
    // is unknown: a reply Google accepted but did not echo yet looks exactly
    // like one it refused. BullMQ's next execution never writes. It reads the
    // review once, sees no reply, and keeps the send `sending` inside the
    // 15-minute propagation grace (reply-publication-workflow.ts
    // UNCERTAIN_SEND_PROPAGATION_GRACE_MS) instead of calling it ambiguous on
    // one absent read. The fail-then-success stub would accept a second PUT, so
    // a single PUT positively proves that no blind resend ran.
    // The first read of the review is the worker's own, made before it claimed
    // (it reads Google before every fresh publication); the second is this
    // read-back.
    await waitFor(
      async () => {
        const gets = await gbpStubControl.calls({
          method: 'GET',
          pathPrefix: `/v4/${s.reviewName}`,
        })
        return gets.length > 1 ? gets : null
      },
      {
        description: 'uncertain provider write read back once, without a second write',
        diagnose: async () => await getReplyForReview(s.reviewId),
      },
    )
    const waiting = await getReplyForReview(s.reviewId)
    expect(waiting).toMatchObject({
      status: 'approved',
      publication_state: 'sending',
      publication_attempts: 1,
    })
    expect(waiting?.reconcile_due_at).not.toBeNull()

    const putsBeforeCheck = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${s.locationName}`,
    })
    expect(putsBeforeCheck).toHaveLength(1)

    await page.goto(`/inbox?propertyId=${s.propertyId}&itemId=${s.inboxItemId}`)
    await expect(page.getByText('Waiting for Google').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('button', { name: 'Try publishing again' })).toHaveCount(
      0,
    )

    // "Check Google again" is a read with a result, never an exception. The
    // attempt is minutes old, so dispatch evidence cannot settle it; Google
    // still shows no reply, and the send keeps waiting.
    const getsBeforeCheck = await gbpStubControl.calls({
      method: 'GET',
      pathPrefix: `/v4/${s.reviewName}`,
    })
    const check = await waitFor(
      async () => {
        try {
          return await callServerFn<{ outcome: string }>(page, {
            file: REPLY_FILE_OPS,
            exportName: 'checkReplyPublicationFn',
            data: { reviewId: s.reviewId },
          })
        } catch (error) {
          // The reads share ONE provider quota with the whole suite.
          if (/couldn't reach Google to check this reply/i.test(String(error))) {
            return null
          }
          throw error
        }
      },
      {
        timeoutMs: 30_000,
        description: 'operator check completed without admitting a resend',
      },
    )
    expect(check.outcome).toBe('not_on_google')
    const checked = await getReplyForReview(s.reviewId)
    expect(checked).toMatchObject({
      status: 'approved',
      publication_state: 'sending',
      publication_attempts: 1,
    })
    const getsAfterCheck = await gbpStubControl.calls({
      method: 'GET',
      pathPrefix: `/v4/${s.reviewName}`,
    })
    expect(getsAfterCheck.length).toBeGreaterThan(getsBeforeCheck.length)

    // A send still in flight is not a failed publication, so "Try publishing
    // again" is refused and enqueues nothing.
    await callServerFnExpectError(page, {
      file: REPLY_FILE_OPS,
      exportName: 'retryPublishFn',
      data: { reviewId: s.reviewId },
    })
    const putsAfterCheck = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${s.locationName}`,
    })
    expect(putsAfterCheck).toHaveLength(1)
  })

  test('(c) terminal 403 permits a fresh retry, which remains terminal', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const s = await setupScenario('terminal', {
      reviews: [stubReview('terminal')],
      replyBehavior: { mode: 'always-fail', status: 403 },
    })
    await signIn(page)

    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'draftReplyFn',
      data: { reviewId: s.reviewId, text: 'Terminal rejection reply text' },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'submitReplyFn',
      data: { reviewId: s.reviewId },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'approveReplyFn',
      data: { reviewId: s.reviewId },
    })

    // Terminal 4xx: one attempt, marked publish_failed/terminal, NO retry burn.
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'publish_failed' &&
          reply?.publication_state === 'terminal'
          ? reply
          : null
      },
      {
        // 90s + diagnose, matching google-import-sync.spec.ts: this polls a
        // real background worker on a runner already hosting nine containers,
        // so the deadline only bounds how long the worker may take — the
        // assertions below are what prove the behaviour. At the old 30s this
        // timed out on a loaded runner (119 probes, no terminal state) and
        // passed on a rerun of the same commit.
        timeoutMs: 90_000,
        description: 'reply terminally publish_failed',
        diagnose: async () => await getReplyForReview(s.reviewId),
      },
    )
    const putsAfterTerminal = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${s.locationName}`,
    })
    expect(putsAfterTerminal).toHaveLength(1)

    // A 403 is conclusive rejection before provider acceptance, so unlike an
    // uncertain 500 it is safe to offer a fresh user-authorized publication
    // cycle rather than a check-only action.
    await page.goto(`/inbox?propertyId=${s.propertyId}&itemId=${s.inboxItemId}`)
    // Every publish failure that is not ambiguous now reads `Not published`, so
    // the chip alone no longer names the failure CLASS. The description below
    // it is what distinguishes a provider rejection from a retryable stop, and
    // the check-only/retry action split below that is what proves the policy.
    // The terminal-rejection sentence no longer says "and permissions": the
    // class also covers a request RepKey refused before sending it, so it says
    // only what both share (`reply-state-copy.ts`, `terminal_rejection`). The
    // connection clause is still the part a retryable stop never prints.
    await expect(page.getByText('Not published').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page
        .getByText('Check the Google Business Profile connection, then try again', {
          exact: false,
        })
        .first(),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try publishing again' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check Google again' })).toHaveCount(0)

    // A fresh retry is offered but does NOT heal against a still-403 provider:
    // the new cycle is rejected conclusively and settles terminal again.
    await callServerFn(page, {
      file: REPLY_FILE_OPS,
      exportName: 'retryPublishFn',
      data: { reviewId: s.reviewId },
    })
    await waitFor(
      async () => {
        const puts = await gbpStubControl.calls({
          method: 'PUT',
          pathPrefix: `/v4/${s.locationName}`,
        })
        return puts.length === 2 ? puts : null
      },
      { timeoutMs: 30_000, description: 'retry re-attempted the provider once' },
    )
    await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'publish_failed' &&
          reply?.publication_state === 'terminal'
          ? reply
          : null
      },
      { timeoutMs: 15_000, description: 'reply stays terminally failed after retry' },
    )
  })

  test('(d) ambiguous + provider shows the reply → reconcile heals without resend', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const s = await setupScenario('ambig', { reviews: [stubReview('ambig')] })
    const admin = await getUserByEmail(seed.email)
    await seedAmbiguousReply({
      organizationId: seed.organizationId,
      reviewId: s.reviewId,
      text: 'The ambiguous send actually landed',
      createdBy: admin!.id,
    })
    // The ambiguous send DID land: Google now serves the reply. It appears only
    // after the attempt exists, as a real send's does. A sync that met the
    // reply before any attempt could only record it as Google-authored, and
    // the inbox shows such a reply in place of RepKey's uncertain one
    // (reply-lookup.adapter.ts) — with no "Check Google again" to press.
    await putScenarioScope('ambig', {
      reviews: [
        {
          ...stubReview('ambig'),
          reviewReply: {
            comment: 'The ambiguous send actually landed',
            updateTime: '2026-07-28T08:00:00Z',
          },
        },
      ],
    })
    await signIn(page)

    // "Check Google again" runs the read INLINE (worker-free): the attempt is
    // too recent for dispatch evidence to settle it, the provider shows the
    // reply → heal to published, no enqueue, no resend. It is pressed in the
    // inbox, because the defect this guards was a click that reported nothing:
    // the check's answer has to reach the manager, not only the database.
    await page.goto(`/inbox?propertyId=${s.propertyId}&itemId=${s.inboxItemId}`)
    const checkButton = page.getByRole('button', { name: 'Check Google again' })
    const toasts = page.locator('[data-sonner-toast]')
    const liveToast = toasts.filter({ hasText: 'Your reply is live on Google.' })
    const unreachableToast = toasts.filter({
      hasText: "couldn't reach Google to check this reply",
    })
    // The sweep may heal the seeded row before the pane loads. Then there is
    // nothing left to press, and the reply already reads Live on Google.
    await expect(
      checkButton.or(page.getByText('Live on Google', { exact: true })).first(),
    ).toBeVisible({ timeout: 15_000 })

    // The reads share ONE provider quota with the whole suite, so a run that
    // follows a read-heavy spec can be admission-denied here. The check says
    // so in a toast and re-enables, which is a transient the operator answers
    // by clicking again, and the assertions below are about the reconcile
    // outcome — not about winning the quota on the first try.
    await waitFor(
      async () => {
        if ((await checkButton.count()) === 0) return 'healed_before_check'
        await dismissToasts(page)
        await clickWhenReady(checkButton)
        await expect(liveToast.or(unreachableToast).first()).toBeVisible({
          timeout: 15_000,
        })
        return (await liveToast.count()) > 0 ? 'checked_live' : null
      },
      { timeoutMs: 30_000, description: 'check admitted by the provider quota' },
    )
    const healed = await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'published' ? reply : null
      },
      {
        timeoutMs: 20_000,
        description: 'ambiguous reply healed to published by reconcile',
      },
    )
    expect(healed.publication_state).toBe('published')

    // Reconciliation is read-only at the provider: ZERO reply upserts.
    const puts = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${s.locationName}`,
    })
    expect(puts).toHaveLength(0)
    // …and it did re-read provider state through the real adapter.
    const gets = await gbpStubControl.calls({
      method: 'GET',
      pathPrefix: `/v4/${s.locationName}/reviews`,
    })
    expect(gets.length).toBeGreaterThan(0)
  })

  test('(e) a reply typed on Google after the last sync is not replaced', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const s = await setupScenario('external', { reviews: [stubReview('external')] })
    // Someone answers on Google itself. RepKey has synced the review without a
    // reply and knows nothing of it until a read records it.
    await putScenarioScope('external', {
      reviews: [
        {
          ...stubReview('external'),
          reviewReply: {
            comment: 'Thanks for your review! - The Front Desk',
            updateTime: '2026-07-28T08:00:00Z',
          },
        },
      ],
    })
    await signIn(page)

    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'draftReplyFn',
      data: { reviewId: s.reviewId, text: 'A reply Google must not receive' },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'submitReplyFn',
      data: { reviewId: s.reviewId },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'approveReplyFn',
      data: { reviewId: s.reviewId },
    })

    // The worker reads the review before it claims, finds a reply that is not
    // on record, and the cycle ends as provider truth: the reply is a draft
    // again, with nothing sent and no attempt written.
    const cancelled = await waitFor(
      async () => {
        const reply = await getReplyForReview(s.reviewId)
        return reply?.status === 'draft' && reply?.publication_state === 'cancelled'
          ? reply
          : null
      },
      {
        timeoutMs: 60_000,
        description: 'reply returned to draft by the worker’s read of Google',
        diagnose: async () => await getReplyForReview(s.reviewId),
      },
    )
    expect(cancelled.publication_attempts).toBe(0)
    const causes = await dbQuery<{ cause: string }>(
      `SELECT payload->>'cause' AS cause FROM outbox_events
        WHERE organization_id = $1
          AND event_type = 'review.reply.publication_cancelled'
          AND payload->>'reviewId' = $2`,
      [seed.organizationId, s.reviewId],
    )
    expect(causes).toEqual([{ cause: 'provider_truth' }])
    const puts = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${s.locationName}`,
    })
    expect(puts).toHaveLength(0)
  })
})
