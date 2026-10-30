---
status: accepted
date: 2026-10-29
---

# 0073 — Reply voice and shared reply templates

Replaces the property-only reply library (`property_reply_profiles`,
`property_reply_templates`) with a layered library and a reply voice that wraps every
reply. It knowingly reverses the owner's 2026-10-06 settings rule "no new
default-for-all-properties chains until an agency asks" (agreed in the settings
brainstorm, never written into an ADR): the beta's main workspace is an agency with
29 of the 32 properties. It follows the inheritance precedents of Response Targets
(organization policy and property override), [ADR 0046](0046-notification-policy.md)
(property, then organization, then a versioned built-in default) and
[ADR 0070](0070-per-portal-look.md) (a sparse live override). It adds no provider input
under [ADR 0031](0031-google-source-content-and-ai-processing-boundary.md) and keeps the
written commitments in `docs/BETA.md`: no automated reply publication, and no reviewer
name sent to an AI provider.

## Context

- Templates and the reply profile exist only per property; there is no organization
  layer and no built-in library, so a new property starts with "No reply templates yet".
  The profile (one greeting, two sign-offs, emoji on/off, an escalation contact) wraps
  library templates only; AI drafts and the AI fallback catalogue ignore it.
- `{guest_name}` must be typed by hand or publishing is refused. "Recommended" is the
  first general template alphabetically; there is no rotation. Template `version` is an
  overwritten counter, so it cannot drive history, pins or "update available".
- `reply.manage` covers both using and editing the library, and PropertyManagers hold
  it, so the rule that admins manage settings is not enforced for replies.
- Read-only beta measurement (2026-10-29): 1 test template and 1 profile in total;
  9,811 replies live on Google, 6 of them (0.1%) published through RepKey. The agency's
  approved Excel templates are live practice (their sentences appear in 53%, 43% and 8%
  of three clients' live replies) and travel between clients (46% of one salon's replies
  use another salon's workbook). One reply body appears 154 times on one profile; Google
  moderates replies and can reject them as `REPETITIVE`. 15% of 1-3-star replies give a
  way to reach the business. 36% of reviews have no text.

## Owner decisions (2026-10-29)

Sixteen decisions from one grilling session; the numbered decisions below implement them.
Q1 a separate reply voice; Q2 first name filled locally; Q3 team signs positives, an
optional named signer signs 1-3 stars; Q4 contact line optional (the owner reversed a
first answer that made it required); Q5 emoji off by default; Q6 the same voice on AI
drafts in the first release; Q7 built-in adopted, shared live; Q8 sets with
availability; Q9 AccountAdmin-only editing; Q10 about 30 built-in templates, the owner
approves the copy; Q11 the review's language first, US English and US Spanish first;
Q12 rotation and a duplicate warning, topic ranking only with review analysis v3;
Q13 a star-only queue without "approve all"; Q14 an ops workbook import; Q15 checks
block only for platform rules, law and broken text; Q16 the release plan.

## Decision

1. **A template is a body plus where it applies**: a star range, text or star-only or
   both, a topic from the twelve topics of review analysis v3 (or none), and its
   wordings. A body never holds a greeting, a sign-off, the business name, contact
   details or emoji; invitations to return belong to the voice's closing.
2. **The reply voice wraps every reply** in this order: greeting, body, contact
   sentence, closing, sign-off word, signer. One pure Review-owned render step serves a
   library template, the AI fallback catalogue (`ai-reply-template-catalogue-v1`) and an
   AI draft. For AI the provider writes the body only; the voice is applied locally,
   after the provider result is accepted and before the rendered text is digested and
   bound into the provenance token, so the adoption check still compares exact text.
   The prompt and the personalized-reply contract take a new version: the rule that the
   model's text contains the public business name is dropped, because the signer carries
   it. A voice change while a suggestion is open makes the suggestion stale, as a Brand
   Profile change does today.
3. **Greeting.** The first word of the Google display name, filled by RepKey and never
   placed in a provider payload. ALL CAPS becomes Title Case; mixed case is kept. The
   greeting falls back to "Hello," for business names, initials, digits, `@` or a
   domain, titles, placeholders, or a script the reply language cannot show. No
   honorifics and no gender guesses. Built-in default "Hi {first_name}," on 4-5 stars and
   star-only, "Hello {first_name}," on 1-3 stars; "Dear {first_name}," is selectable. A
   "Use first name" switch, on by default; a privacy mode for health businesses uses no
   name at all.
4. **Signer.** "{business_name} Team" on positive and star-only replies;
   "{signer_name}, {signer_title}" on 1-3 stars when the property sets a signer, else
   "{business_name} Management"; each band can be changed per property. The signer is a
   property setting and never the approving user, so agency staff never sign a client's
   reply. Shared templates never hold a person's name. Sign-off words rotate per band.
5. **Contact sentence.** Optional. When a property sets a contact it is added on 1-2
   stars, by default on 3 stars (removable per reply) and never on 4-5 stars, in one of
   2-3 rotating wordings per language. Without a contact, complaint replies end with a
   contact-free closing. Nothing blocks on it.
6. **Emoji.** Off by default. "In positive replies" adds at most one emoji after the
   closing on 4-5-star and star-only replies, from the property's small rotating set;
   never on 1-3 stars and never in a body.
7. **Three layers.** The built-in library is RepKey-owned, versioned and read-only. An
   account **adopts** a built-in revision: a newer built-in revision shows "Update
   available" side by side and changes nothing until an AccountAdmin accepts it; RepKey
   may withdraw a built-in template that breaks a platform rule or law. Account to
   property is **live**: a property uses a shared template as it is, may **Customize** it
   (a property revision that records the revision it was based on), **Hide** it, or
   **Reset** it (the customization is removed). An edit to a shared template reaches every
   untouched property at once; a customized property keeps its text and shows "Shared
   version changed — review". Nothing overwrites a customization.
8. **The voice inherits field by field**: property, then account, then built-in. An
   explicit override mask tells "inherit" from "intentionally blank"; Reset works per
   field. Greeting, closings, contact sentences, signer patterns and the visit word are
   stored per language; the contact value, emoji rule and switches are language-neutral.
9. **Sets.** Every shared template lives in one set, available at "All properties" (the
   default) or "Selected properties". The built-in library is a set and can be narrowed.
   A property may use several sets. An imported client workbook becomes a set available
   at that client.
10. **One property shows no layers.** The library is stored at account level, so a second
    property inherits it; at one property the UI never says "organization", "shared",
    "set" or "inherited". At two or more properties each set shows one "Available at" line
    and each template one status (built-in, shared, customized, hidden, only here).
11. **Rights.** A new `reply_library.manage` permission, AccountAdmin only, covers
    templates, sets, customize/hide/reset and the voice with its property overrides.
    `reply.manage` stays the Inbox permission (choose a template, edit the reply text,
    submit); PropertyManagers see the library and voice read-only. No personal templates.
12. **Revisions, wordings and languages.** A template has immutable revisions; a revision
    has wordings, each with language versions, under one stable key. A reply records the
    template, revision, wording, layer it resolved from, and the voice digest. A usage
    read model written on confirmed publication drives rotation. Provenance stays
    informational (no foreign key), so purge keeps content-free reply history.
13. **Choosing in the Inbox.** Hard filters (visible at the property, stars, text or
    star-only, reply language), then general templates first, then the wording least
    recently published on that property, with "Another wording" and a shown reason. Before
    approval a warning (never a block) appears when the final text is at least 80% similar
    to one of the last 20 replies on that Google profile. Topic ranking and `{thing}`
    prefill wait for review analysis v3; there is no mapping from the v2 aspects. `{thing}`
    is never prefilled into a non-English reply (v3 things are English phrases).
14. **Reply language.** The review's language as evaluated by the review analysis
    (`analyze-review-event.ts`, `evaluatedLanguage`), else the property's default; the
    manager may switch it; a reply never mixes two languages. A template without a version
    in that language says so and offers another; nothing is translated on the fly.
15. **Checks.** Run in the template editor and on the final reply text. They block only
    for platform rules, law and broken text: offers, discounts, links, "book now"; a
    benefit for changing or removing a review; threats and accusations; unknown variables
    and leftover placeholders; more than 4,096 UTF-8 bytes or two languages; in privacy
    mode the name and health words; in star-only templates, thanks for words that were not
    written (at template save). Everything stylistic warns.
16. **Lifecycle.** Built-in content ships in the repository and survives every tenant
    purge. Account and property library rows, overrides and usage are tenant data: purged
    with the organization and included in the organization export, which today omits the
    library and property-template provenance.
17. **Migration.** The one existing template becomes a property-layer template with one
    wording; the one profile becomes property voice overrides. Legacy
    `template_id`/`template_version` pairs on replies stay as legacy provenance.

## Data model (direction, not a migration)

```text
reply_template_sets(id, organization_id, name, availability, created_by, timestamps)
reply_template_set_properties(organization_id, set_id, property_id)
reply_templates(id, organization_id, set_id | property_id, builtin_key, based_on_revision_id,
  current_revision_id, adopted_builtin_revision, archived_at, timestamps)
reply_template_revisions(id, template_id, number, stars_min, stars_max, review_kind,
  topic_taxonomy_version, topic, created_by, created_at)
reply_template_wordings(id, revision_id, wording_key, language_tag, body)
property_reply_template_overrides(organization_id, property_id, template_id,
  mode hidden | customized, customized_template_id, version, audit)
reply_voice_policies(scope account | property, organization_id, property_id, contact,
  emoji_mode, emoji_set, use_first_name, privacy_mode, signer_name, signer_title,
  business_name_short, overridden_fields, version, audit)
reply_voice_localizations(policy_id, language_tag, greeting_by_band, closings_by_band,
  contact_sentences, sign_off_words_by_band, signer_patterns, visit_word, overridden_fields)
reply_template_usage(organization_id, property_id, source_epoch, reply_id, template_id,
  revision_id, wording_id, published_at)
```

Built-in templates are versioned JSON in the repository, keyed by `builtin_key`, and are
read through the same resolver; an account row exists only once an account adopts,
customizes or hides one.

## Consequences

- One resolver module in the Review context owns precedence; the Inbox receives an
  opaque resolved reference and Review revalidates it on load.
- The AI reply route gains a resolved voice through a Review public port, never through
  Review infrastructure; the voice is not part of `providerPayload`.
- The import script is rewritten to read the agency `.xlsx` layout, produce a dry-run
  report, create a set per workbook and match on stable keys, never on titles.
- Reply quality becomes measurable from the usage model and Google's moderation state.
- The review analysis v3 work touches the same shared AI files; the AI part of this
  change lands after, or is rebased onto, the next v3 pull request.

## Rejected alternatives

- **Copy templates into each property**: drift at 29-60 properties and no live update;
  copying stays only for built-in adoption.
- **One template table with nullable scopes**: tenant-leakage and uniqueness risk; it
  becomes the layered model once hide, customize and reset are added.
- **Organization templates visible at every property**: puts salon wording in a hotel's
  composer in a mixed agency workspace; sets with availability instead.
- **A required contact line**: some properties do not want to publish a contact (owner).
- **Mapping v2 aspects to v3 topics**: throwaway work; topic ranking waits for v3 (owner).
- **"Approve all" in the star-only queue**: weakens "publishing is a separate manual
  action"; one approval per reply instead.
- **The approving user as signer**: agency staff names would appear on client replies.
- **Sending the reviewer's first name to the AI**: contradicts the merchant notice; the
  voice fills it locally.
