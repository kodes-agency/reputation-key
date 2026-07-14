# POST-BETA-2 — Public Portals and Guest Experience

**Status:** Proposed  
**Depends on:** POST-BETA-1 portal model; beta public-edge, privacy, capability, and object-storage foundations  
**Contexts:** Portal, guest, property, identity, activity, notification  
**Effort:** 8–13 engineering days without uploads; add 4–6 days if guest media ships

## 1. Goal

Provide a fast, accessible, abuse-resistant public property touchpoint that helps a guest reach the property's legitimate public review destination. Optional private rating/feedback is secondary and must not steer, gate, hide, reorder, or emphasize the review link based on the guest's response.

This phase does not reposition Reputation Key around guest feedback. The manager inbox and actual reviews remain the product center. A property may enable a portal with only property identity and review links; private responses and media each have their own capability.

## 2. Scope

### In

- Canonical public portal URL/token lifecycle for QR, NFC, and human-readable short links.
- Property-branded, property-local portal page with safe external review links.
- Independent capabilities for portal page, private response, free text, media upload, and contact follow-up.
- One coherent guest response aggregate when private response is enabled.
- Signed server-issued session, trusted-proxy handling, layered abuse limits, replay/duplicate handling, and moderation.
- Clear privacy/strictly-necessary-cookie notice and retention/deletion rules.
- Safe link validation and no arbitrary redirect endpoint.
- Optional quarantined private media pipeline.
- Accessibility, localization readiness, performance, observability, support, and kill switches.

### Out

- Rating-conditioned review-link visibility/order/emphasis (“review gating”).
- Incentives for positive reviews or staff coaching based on private ratings.
- Marketing analytics, advertising trackers, fingerprinting, or third-party scripts.
- Native mobile app deep-link behavior; verified App/Universal Links can be added later.
- AI analysis of guest feedback.
- Guest accounts or long-lived cross-property identity.

## 3. Current-state findings to resolve

| Finding                                                                          | Risk                                                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| Client JavaScript creates `guest_session` before the server                      | Guest can rotate identity and evade per-session controls; cookie is not trustworthy.                     |
| Server accepts any cookie value and lacks full production attributes             | Session is unsigned/replaceable and may be sent insecurely.                                              |
| Raw `X-Forwarded-For` is trusted                                                 | Attackers can spoof network identity unless proxy chain is configured.                                   |
| Scan is recorded on page effect/mount                                            | Refresh, prefetch, bots, or link scanners inflate scan metrics.                                          |
| `source=qr                                                                       | nfc                                                                                                      | direct` comes from the URL/client | Source is a campaign hint, not verified physical behavior. |
| Star rating and feedback submit independently                                    | A guest can create inconsistent partial records and cannot naturally correct one response.               |
| Review links are shown alongside conditional feedback logic                      | UI evolution can drift into prohibited review gating.                                                    |
| Cookie copy says no personal data is collected                                   | Session IDs, network-derived abuse signals, device metadata, free text, or uploads can be personal data. |
| Upload presign/finalize/processing is weakly bound and objects can be public     | Arbitrary key finalization, resource bombs, public exposure, and orphaned objects are possible.          |
| Portal/property and guest/property relations lack strong foreign-key consistency | Tenant/property ownership can be violated by a buggy command.                                            |

## 4. Product contract

### 4.1 Public journey

Default first release:

1. Resolve an opaque, rotatable portal token to one active portal and property.
2. Render property identity, accessibility-safe instructions, and approved public review links.
3. Offer private feedback separately only if its capability is enabled.
4. Keep the public review action visible with the same label, order, visual prominence, and availability regardless of whether the guest opens/submits/dismisses private feedback or which rating they choose.
5. Open the selected provider URL directly after server validation; never accept an arbitrary redirect target from query/body input.

Do not auto-submit a rating on star selection. If private feedback is enabled, present one reviewable response form: optional rating, optional category, optional text, optional contact consent/details, and optional media. The guest explicitly submits, receives status, and may make one bounded correction through the same signed session during a short window.

### 4.2 Token and source semantics

- Public URL uses a high-entropy random token; store only a keyed hash where possible.
- Token rotation supports a grace period for already printed codes, explicit revocation for compromise, version/batch metadata, and audit.
- QR/NFC/short URL are campaign media, not proof of a physical scan. Record `campaign_medium_hint` and `token_version`; do not name it a verified scan source.
- A page view is not a guest intent signal. Count a deduplicated server-side `portal_visit` only after a real HTTP navigation survives basic bot/link-preview filtering. Keep raw operational request telemetry separate from product metrics.
- Print the recognizable HTTPS domain and a human-readable short URL next to the QR code. Provide tamper-evident placement guidance.

### 4.3 Privacy and data classes

| Data                                | Default retention posture                                      | Public/manager visibility                            |
| ----------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| Portal configuration/token metadata | Portal lifecycle plus audit retention                          | Managers; token secret never returned after creation |
| Signed session identifier           | Short abuse/correction window; rotate and expire               | Not visible in product UI                            |
| Network-derived abuse hash          | Short, documented security retention with rotating secret      | Restricted operations only                           |
| User agent/request telemetry        | Minimized operational retention                                | Restricted operations only                           |
| Private rating/text/category        | Product-configured retention with notice and deletion workflow | Authorized property managers                         |
| Contact details/consent             | Separate purpose and short follow-up retention                 | Explicitly authorized property staff only            |
| Quarantined media                   | Hours/days, automatically deleted if not accepted              | No normal access                                     |
| Accepted media/variants             | Response retention; all derivatives deleted together           | Authorized property managers through signed access   |

The notice must name the property/controller relationship, purposes, categories, recipients/processors, transfers where applicable, retention, rights/contact, and relevant moderation. Use “you can submit without giving your name” only when true; do not claim anonymous collection.

Initial portal uses only a signed, `Secure`, `HttpOnly`, appropriately scoped `SameSite` cookie necessary for abuse protection/correction. No consent banner theater is needed for strictly necessary storage, but a concise disclosure is. If non-essential analytics is introduced later, it is separately consent-gated where required.

### 4.4 Abuse and moderation

- Derive client network identity only from the configured trusted proxy chain.
- Layer limits by portal/token, signed session, trusted network signal, organization/property, and operation.
- Use different budgets for view, response submit, correction, contact request, presign, finalize, and media processing.
- Enforce body bytes, text length, field counts, media count/bytes/pixels/frames, request time, and downstream cost.
- Add idempotency key/nonce for submit and correction; duplicates return the existing result.
- Use honeypot, minimum interaction time, reputation/risk signals, and quarantine before an inaccessible CAPTCHA. If CAPTCHA becomes necessary, provide an accessible alternative.
- Managers may hide/quarantine abusive content without destroying evidence. Report/block workflow and support escalation are documented.
- Public edge fails closed for submissions and uploads if the authoritative limiter/session/validation dependency is unavailable. The static portal/review link may remain available through a deliberately separate read path.

## 5. Proposed data/API changes

### 5.1 Portal public access

Add or formalize:

- `portal_public_tokens`: token hash, portal/property/org, version, status, issued/revoked/grace timestamps, print batch, created/revoked actor.
- `portal_links`: provider/kind, validated destination, display label, ordering independent of guest response, status, last verification.
- `portal_visits`: deduplicated product visit ID, portal/token version, coarse campaign hint, occurred time, source event/idempotency key, classification confidence. Do not store raw IP.

Use server functions/handlers that return a minimal public read model. They must not expose organization IDs, database IDs, staff personal data, internal settings, signed object keys, or provider credentials.

### 5.2 Guest response aggregate

Prefer one aggregate rather than unrelated rating and feedback submissions:

- `guest_responses`: ID, org/property/portal, signed-session reference, status, rating/category/text, contact consent/reference, submitted/corrected/moderated/deleted timestamps, schema version.
- `guest_response_media`: issued upload reference, response, state, immutable accepted key, metadata, scan/moderation status, retention/deletion status.
- `guest_response_actions`: append-only correction/moderation/deletion evidence or corresponding domain events.

If migration must preserve old rating/feedback tables, first build a compatibility view/read model. Do not guess that unrelated historical rows belong to one response.

### 5.3 Safe upload capability (only if enabled)

1. Authenticated public session requests an upload capability with declared content type/size/checksum.
2. Server issues one random organization/property/response-scoped key and one single-use nonce; presign lifetime is minutes, not an hour.
3. Upload enters a private quarantine prefix with Block Public Access/ACLs disabled.
4. Finalize accepts only the exact issued key/nonce and verifies checksum, actual bytes, file signature, dimensions/frame count, response ownership, and expiry.
5. Decode/re-encode in an isolated worker with memory, time, byte, pixel, and concurrency bounds; strip metadata.
6. Scan/moderate as required; move/copy to an immutable application-owned private key only when clean.
7. Serve through authorized, short-lived signed access or application proxy.
8. Lifecycle rules delete unfinalized/quarantined/orphaned objects. Privacy deletion removes source and every derivative.

Do not fetch arbitrary URLs during processing. Workers operate only on issued private storage keys.

## 6. Work packages

### PB2.0 — Product/policy decision and capability split

1. Accept ADR 0044.
2. Decide whether the first release is link-only or includes private response.
3. Create separate server capabilities: `public_portal`, `private_response`, `free_text`, `guest_contact`, `guest_media`.
4. Translate Google's written response into an executable link/metric/content capability; obtain legal/product review for the exact public journey.
5. Record controller/processor roles and retention by property region.

**Exit:** A screenshot/prototype and decision test prove review-link behavior never depends on rating/feedback.

### PB2.1 — Canonical token, URL, and link module

1. Add token lifecycle and migration from current slugs/links.
2. Add destination allowlist/validator for approved `https` providers and property-owned URLs. Reject unsafe schemes, credentials, control characters, and open redirect patterns.
3. Add rotation/revocation/grace commands and printable QR/short-link artifact metadata.
4. Build a minimal cacheable public read model with bounded invalidation.
5. Add generic not-found/disabled/expired states that do not reveal tenant existence.

### PB2.2 — Signed session and public request identity

1. Remove client-generated session cookies.
2. Issue signed/encrypted opaque session cookie server-side with key version, expiration, `Secure`, `HttpOnly`, scoped path/domain, and appropriate `SameSite`.
3. Rotate signing keys with overlap; reject invalid/expired cookies and issue a new session without accepting attacker-provided identity.
4. Implement accepted proxy topology and tests for direct/spoofed/multi-proxy requests.
5. Configure layered, operation-specific limits with explicit failure behavior.
6. Redact cookies, tokens, network identifiers, text, and upload keys from logs/errors/traces.

### PB2.3 — Public portal UI and visit semantics

1. Render server-first HTML with resilient property branding and verified links.
2. Record deduplicated visits server-side after bot/link-preview classification; remove client-mount scan event.
3. Rename source analytics to campaign hints and display confidence/limitations in manager analytics.
4. Make external navigation explicit and accessible.
5. Cover missing logo, long/localized property names, large text, high contrast, no JavaScript, slow network, offline transition, expired/disabled token, and provider link failure.
6. Meet field-performance targets and keep third-party JavaScript at zero initially.

### PB2.4 — Optional private response

1. Implement the response aggregate and one explicit submit command.
2. Permit blank optional fields only when the aggregate still has meaningful content; validate Unicode, length, and unsafe control characters.
3. Add bounded session-based correction with append-only change evidence.
4. Add manager inbox/list/detail/moderation with cursor pagination and safe text rendering.
5. Separate contact consent and follow-up fields from feedback; never treat response submission as marketing consent.
6. Add deletion/anonymization/export workflows and purge projection/cache/search/media copies.
7. Notify managers with metadata only; do not put guest text or media in email/lock-screen content.

### PB2.5 — Optional media

Implement the safe upload capability in section 5.3. If this work package is not accepted, remove/hide every upload route, worker, scheduler, storage permission, and UI affordance—not only the form control.

### PB2.6 — Operations, support, and rollout

1. Dashboards: request rate, token-not-found, link failure, limiter decision, response acceptance/quarantine, duplicate, processing age/failure, object count/bytes, deletion lag.
2. Alerts/runbooks: abuse burst, limiter unavailable, session signing error, unsafe-link detection, malware/decoder failure, public object exposure, orphan backlog.
3. Property kill switch plus global response/upload kill switches that preserve the static verified review-link page when safe.
4. Start with one US property, link-only. Add private response only after notice/retention/support approval. Add media last.

## 7. Test matrix

### Security and abuse

- token enumeration, rotation, grace, revocation, replay, and cross-property access;
- spoofed proxy headers, replaceable cookies, forged signatures, expired keys, CSRF/origin behavior;
- burst, slow, distributed, duplicate, and dependency-unavailable limiter cases;
- unsafe URL schemes/redirects and property-link ownership;
- XSS/Unicode/control characters in all guest/branding fields;
- upload polyglots, incorrect MIME/signature/checksum, overwrite attempts, zip/image bombs, oversized dimensions/frames, arbitrary key/URL, malware, timeout, orphan cleanup;
- no secrets, text, tokens, IP/network identifiers, or object keys in logs.

### Correctness and lifecycle

- review links identical before/after every rating value and private-response state;
- partial/double/corrected submissions and worker retries are idempotent;
- portal archive/token rotation/property archive/guest deletion propagate correctly;
- retention and region routing cover primary, backup, cache, queue, object, log, and derived copies;
- campaign hint is never presented as verified scan source.

### UX/accessibility/performance

- keyboard, screen reader, status announcements, labels/errors, target size, 200%/400% zoom, reflow, contrast, reduced motion;
- current/previous Chrome, Safari, Firefox; mobile Safari/Chrome; no-JS link journey;
- long/localized text and right-to-left readiness even if translation ships later;
- LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 at p75 field target; load tests include link-preview and abuse traffic.

## 8. Gate criteria

- A guest can reach the correct verified review destination quickly without giving a rating or private feedback.
- Review destination visibility, ordering, wording, and prominence are invariant across guest response values/states.
- Tokens are opaque, rotatable, revocable, non-enumerable, and reveal no internal identifiers.
- The server—not client JavaScript—owns signed session identity and visit recording.
- Public submissions are tenant-safe, idempotent, bounded, rate-limited, privacy-noticed, and deletable.
- If media is enabled, no bucket/object is public and every upload passes capability binding, quarantine, validation, bounded processing, and lifecycle deletion.
- Portal passes WCAG 2.2 AA checks and performance budgets.
- One property completes at least 14 observed days with actionable monitoring and no unresolved P0/P1 security/privacy/accessibility issue.

## 9. Decisions required before PB2.0 exits

| Decision             | Recommended default                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| First public release | Link-only property portal; add private response after observation.                                               |
| Rating/text          | Optional and submitted together; do not auto-submit stars.                                                       |
| Contact follow-up    | Off initially; separate explicit consent if later enabled.                                                       |
| Guest media          | Off initially; ship only if real property testing shows need.                                                    |
| Corrections          | Same signed session, one-hour window; configure from evidence later.                                             |
| Minors               | No service directed to children; add clear submission language and obtain counsel for family-focused properties. |
| Analytics            | First-party operational/product events only; no third-party analytics on the public page.                        |
