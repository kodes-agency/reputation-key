# Post-beta contexts: primary-source research

**Status:** Evidence base for product and engineering planning  
**Prepared:** 2026-07-14  
**Market order:** United States first, Europe second, then other jurisdictions  
**Scope:** goals, metrics, teams, staff, badges, leaderboards, activity/audit, notifications, public property portals, guest feedback, QR/NFC links, image uploads, accessibility, performance, and lifecycle/retention

This document is research, not legal advice. It deliberately separates binding law and vendor policy from regulator guidance, engineering recommendations, and decisions that require product or legal review. All external sources are primary or first-party sources.

## How to read the labels

- **Legal requirement** — a requirement found in legislation, regulation, or an enforceable rule. Whether it applies still depends on the company, customer, data, jurisdiction, and use case.
- **Vendor requirement** — a contractual/platform policy required to use a provider such as Google Business Profile.
- **Official guidance** — regulator, standards-body, or security-project guidance. It is not automatically binding law, but is strong evidence for design and due diligence.
- **Recommendation** — a proposed RepKey product or engineering control derived from the risks and sources.
- **Decision required** — an issue that product leadership and/or qualified counsel must resolve before the affected capability launches.

## Executive findings

1. **Google review data is the immediate hard gate.** The current Business Profile API policy allows only limited, secure, temporary storage for no more than 30 days and says stored API content cannot be manipulated or aggregated. Under the conservative reading, review-derived metric readings, goals, badges, leaderboard snapshots, historical trends, and AI analysis are not launchable unless Google gives written approval or clarification. [Google Business Profile API policies](https://developers.google.com/my-business/content/policies)
2. **Review-solicitation gamification is independently prohibited.** Google forbids merchants from discouraging negative reviews, selectively soliciting positive reviews, requesting that staff solicit a certain number of reviews, or requesting staff-identifying review content. Goals, badges, rankings, or incentives based on review-link clicks, Google review count, Google rating, or named-staff mentions would create direct policy risk even if the storage issue were resolved. [Google Maps prohibited and restricted content](https://support.google.com/contributionpolicy/answer/7400114?hl=en)
3. **Guest portals must not implement review gating.** A guest's private rating must not change whether, where, or how prominently an external review link appears. The safest implementation is one identical path and layout for every rating, with private feedback clearly separated from the external-review action. Google requires genuine, unbiased contributions and the FTC prohibits several deceptive review and review-suppression practices. [Google Maps policy](https://support.google.com/contributionpolicy/answer/7400114?hl=en), [FTC Consumer Reviews and Testimonials Rule Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)
4. **Goals and gamification can become worker monitoring.** Portal/team/staff activity, private ratings, response speed, and rankings can identify or profile employees. In Europe this invokes GDPR transparency, purpose limitation, minimization, accuracy, retention, rights, and potentially DPIA/automated-decision safeguards. In the US, use in hiring, promotion, discipline, compensation, or termination can engage discrimination law, state monitoring notices, state privacy law, and local automated-employment rules.
5. **The product should be contractually and technically separated from employment decisions.** Post-beta v1 should be a coaching and operational-recognition system only. It should not recommend or automatically trigger hiring, firing, promotion, pay, scheduling, task allocation, or discipline. Any later move into those uses requires a separate legal, fairness, and product program.
6. **The current metric vocabulary is too permissive for downstream gamification.** A metric needs provenance, privacy classification, correction behavior, retention class, and an explicit allowlist of consumers. “Recorded” must not automatically mean “eligible for goals, badges, or leaderboards.”
7. **Activity and security audit are different products.** The user-visible activity feed can be friendly, scoped, and redactable. Security/compliance audit evidence needs broader event coverage, stricter access, tamper resistance, retention controls, and a separate payload policy.
8. **Public portal infrastructure needs its own trust boundary.** Public submissions, redirects, cookies, QR/NFC attribution, and uploads need abuse budgets, server-issued identities, strict URL controls, safe file processing, and separate observability from authenticated application traffic.
9. **Accessibility and performance are launch properties, not polish.** The public portal should target WCAG 2.2 AA and “good” Core Web Vitals at the 75th percentile, including on representative mobile connections.

## Repository facts that shape the plan

The observations below come from the repository's context documentation as it existed on 2026-07-14:

- `metric` records `portal.scan`, `portal.rating`, `portal.feedback`, `portal.review_link_click`, and `property.review`; every reading emits `metric.recorded`.
- `goal` consumes metric readings and permits property, portal, and portal-group goals. Its current “outcomes-not-levers” rule still grandfathers scans as a goal-eligible outcome, and staff can create goals.
- `badge` evaluates portal/portal-group metrics. Awards are currently defined as immutable and never revoked, including after membership or definition changes.
- `leaderboard` ranks portals and portal groups. A portal can represent a staff member, so the leaderboard can be an indirect individual worker ranking even without a `staff` target type.
- `leaderboard` uses property-local maximum-value normalization, has a five-rating floor only for private-rating averages, and has no sample floor for scans, feedback, or clicks.
- `portal` includes public pages, links, themes, image uploads, QR URLs, groups, and rating-sensitive “smart routing.”
- `guest` is unauthenticated, records scans, private ratings, free-text feedback, and external-link clicks, and associates interactions with a session cookie. Its context explicitly requires external review links to remain identically visible.
- `activity` currently consumes inbox and reply events, stores denormalized actor identity, and calls the result an immutable audit log.
- `notification` supports in-app and email channels, treats a missing preference as both channels enabled, and schedules digests by property timezone.

These are not accusations of legal non-compliance. They identify where the future product design intersects vendor policy, worker privacy, fairness, and public-edge risk.

## 1. Google Business Profile and consumer-review policy

### 1.1 API content storage and derived data

**Vendor requirement.** Google's Business Profile API policy says that content obtained through the API may be stored only in limited amounts to improve project performance, for no more than 30 calendar days, securely, and without manipulation or aggregation. Google may disable a non-compliant API project. [Google Business Profile API policies](https://developers.google.com/my-business/content/policies)

**Conservative consequence for RepKey.** Until Google responds in writing:

| Proposed use                                                                                        | Current disposition                                                                                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Display a fetched review temporarily in an authorized management workflow                           | Potentially permissible within the 30-day and security limits; confirm exact design with Google            |
| Persist review text/rating indefinitely                                                             | Blocked under the published policy                                                                         |
| Convert Google rating/review into long-lived `property.review` metric readings                      | Blocked; this is at least storage and likely manipulation                                                  |
| Calculate rating averages, review counts, trends, or priority distributions from stored GBP content | Blocked; the policy expressly bars aggregation                                                             |
| Use Google reviews in goals, badges, leaderboards, or employee/portal rankings                      | Blocked on storage/aggregation grounds and may also conflict with review-solicitation rules                |
| Send Google review content to an AI provider                                                        | Blocked pending explicit permission, lawful data-processing terms, and an approved retention/region design |

**Decision required.** Preserve Google's answer, the submitted architecture, and any conditions as a versioned compliance artifact. Do not generalize permission beyond the exact endpoints, data fields, storage duration, transformations, regions, and user flows Google approves.

**Operational vendor requirements.** Google requires a quick disassociation path: after an end-client relationship ends, the client must be able to disassociate and regain exclusive control, and permissions must be relinquished within seven business days. Google may also request a live or live-equivalent demo and requires it within seven days. These obligations should become tested offboarding and compliance-demo runbooks, not manual promises. [Google Business Profile API policies](https://developers.google.com/my-business/content/policies)

### 1.2 Review solicitation, incentives, and staff quotas

**Vendor requirement.** Google permits asking for genuine reviews without incentives or influence. It prohibits:

- incentives for a review, revision, or removal;
- discouraging or prohibiting negative reviews;
- selectively soliciting positive reviews;
- requiring or pressuring a user to review while on premises;
- asking staff to solicit a certain number of reviews; and
- asking for review content that identifies a staff member.

[Google Maps prohibited and restricted content, “Rating Manipulation”](https://support.google.com/contributionpolicy/answer/7400114?hl=en)

**Legal requirement, US.** The FTC's Consumer Reviews and Testimonials Rule prohibits several fake-review, sentiment-conditioned incentive, insider-review, and review-suppression practices. The Consumer Review Fairness Act also prevents form-contract terms that bar or penalize honest consumer reviews. [FTC rule Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers), [FTC Consumer Review Fairness Act guidance](https://www.ftc.gov/business-guidance/resources/consumer-review-fairness-act-what-businesses-need-know)

**Recommendation.** Permanently classify the following as **analytics-only and never gamification-eligible**:

- external review-link clicks;
- QR/NFC scans whose destination includes a review request;
- Google review count or rating;
- number of guests asked for a review;
- reviews mentioning a named staff member; and
- any conversion rate from private rating to public review.

This prohibition should live in domain policy, not only UI copy. It should apply to goals, badges, leaderboards, notifications, exports, AI summaries, and APIs.

### 1.3 Reply authorization

**Vendor requirement.** Responding to reviews on behalf of an end client requires authorization. Google also prohibits automating or triggering replies without the user's prior specific and express consent. [Google Business Profile API policies](https://developers.google.com/my-business/content/policies)

**Recommendation.** Even post-beta, AI drafting may prepare text but must not publish. Publication should show the property, review, final text, actor, and external effect; require an explicit human action; use idempotency; and retain authorization evidence without retaining prohibited review content longer than allowed.

## 2. Worker data, monitoring, and automated decisions

### 2.1 United States

**Legal requirement where applicable.** Federal employment-discrimination laws apply to selection and employment procedures regardless of whether software is involved. The EEOC explains that a neutral procedure can be unlawful when it disproportionately excludes protected groups and is not job-related and consistent with business necessity; disability-related tools also require accommodation where applicable. EEOC technical assistance is guidance and does not itself create new law. [EEOC employment tests and selection procedures](https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures), [EEOC AI and ADA resources](https://www.eeoc.gov/eeoc-disability-related-resources/artificial-intelligence-and-ada)

**Legal requirement where applicable.** New York Civil Rights Law §52-c requires prior written notice and employee acknowledgment for specified electronic monitoring of telephone, email, and internet usage, plus a posted notice. Connecticut General Statutes §31-48d requires prior notice for covered electronic monitoring, subject to exceptions. These statutes do not automatically classify every RepKey metric as covered monitoring; counsel must map actual deployment and workplace location. [New York §52-c](https://www.nysenate.gov/legislation/laws/CVR/52-C%2A2), [Connecticut §31-48d](https://www.cga.ct.gov/2025/pub/chap_557.htm#sec_31-48d)

**Legal requirement where applicable.** New York City's Local Law 144 restricts use of covered automated employment decision tools unless a recent independent bias audit, publication, and notices are provided. Its scope concerns tools that substantially assist hiring or promotion decisions, so ordinary coaching displays are not automatically covered. [NYC Department of Consumer and Worker Protection](https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page)

**Legal requirement where applicable.** California's CCPA includes California residents who are employees, applicants, and independent contractors when the business and processing are in scope. Rights and business duties include notice, access/knowledge, deletion subject to exceptions, correction, and limits around certain sensitive information. [California Privacy Protection Agency FAQ](https://cppa.ca.gov/faq), [California Attorney General CCPA overview](https://oag.ca.gov/privacy/ccpa)

**Legal requirement where applicable, effective dates.** California's finalized CCPA regulations covering risk assessments and automated decisionmaking technology took effect on 2026-01-01. The CPPA says covered businesses using ADMT for significant decisions must comply with the ADMT requirements beginning 2027-01-01; the final text and the customer's facts determine scope. This reinforces the need to keep RepKey outside significant employment decisions by default. [CPPA final regulations](https://cppa.ca.gov/regulations/ccpa_updates.html), [CPPA effective-date announcement](https://cppa.ca.gov/announcements/2025/20250923.html)

**Legal requirement where applicable, future gate.** Colorado's amended Automated Decision-Making Technology law applies from 2027-01-01 to covered developers and deployers whose ADMT materially influences consequential decisions, including employment. Rulemaking was still in progress on this document's date, so Colorado employment-decision use needs a dated re-check before launch. [Colorado Attorney General ADMT rulemaking](https://coag.gov/ai/)

**Legal requirement where applicable.** Delaware also requires specified notice for monitoring telephone, email, and internet access/usage. It should join New York and Connecticut in a state-by-state customer deployment matrix rather than being handled by one generic US notice. [Delaware Code, Title 19 §705](https://delcode.delaware.gov/title19/c007/sc01/index.html)

**Caution on superseded guidance.** The NLRB's 2022 General Counsel memorandum on electronic monitoring was rescinded on 2025-02-14. It should not be cited as current binding policy. [NLRB General Counsel memo index](https://www.nlrb.gov/guidance/memos-research/general-counsel-memos?page=1)

### 2.2 European Union and United Kingdom

**Legal requirement where applicable.** Employee identifiers, assignments, activity, scores, rankings, and inferred performance are personal data when linked or linkable to a person. GDPR requires a lawful, fair, transparent, purpose-limited, minimal, accurate, secure, and time-limited design; it also provides access, correction, objection, erasure, and automated-decision rights subject to the Regulation's conditions. Privacy by design/default and processor contracts are required where applicable. [GDPR, Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj)

**Legal requirement where applicable.** A DPIA is required before processing likely to create high risk. The EDPB identifies evaluation/scoring, systematic monitoring, vulnerable data subjects such as employees, dataset combination, and innovative technology as relevant criteria. Systematic employee monitoring and HR profiling appear on supervisory-authority DPIA lists. [EDPB DPIA guidance](https://www.edpb.europa.eu/topics/accountability-and-compliance-tools/data-protection-impact-assessment_en), [EDPB small-business compliance guide](https://www.edpb.europa.eu/sme/be-compliant/be-compliant_en)

**Legal requirement where applicable.** GDPR Article 22 and related safeguards become relevant if profiling or automated processing is used to make a solely automated decision producing legal or similarly significant effects. [EDPB automated decision-making and profiling guidance](https://www.edpb.europa.eu/documents/guideline/automated-decision-making-and-profiling_en)

**Official guidance, UK.** The ICO says worker monitoring must have a defined purpose and lawful basis, be necessary, proportionate, transparent, accurate, secure, and retained only as long as needed. It recommends a DPIA and says monitoring that may cause financial loss, such as performance management, can be high risk. [ICO monitoring workers guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/monitoring-workers/data-protection-and-monitoring-workers/)

**Legal requirement / volatile implementation date.** The EU AI Act treats certain AI used for recruitment, promotion, termination, task allocation, and worker monitoring as high-risk and prohibits certain workplace emotion-recognition uses. The Commission's July 2026 implementation page reports a political agreement to move employment high-risk application to 2027, while the enacted Regulation contains the underlying classification and obligations. Counsel must verify the final Official Journal text and applicable date immediately before any EU launch. [AI Act, Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng), [European Commission AI Act implementation](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)

### 2.3 Product boundary for post-beta v1

**Official research framing.** The International Labour Organization defines algorithmic management to include tracked-data systems that organize, assign, monitor, supervise, or evaluate work, including simple rules-based systems rather than AI alone. Accordingly, deterministic goals and rankings can still be worker-management systems. [ILO algorithmic management in the workplace](https://www.ilo.org/algorithmic-management-workplace)

**Recommendation.** RepKey should state and enforce that goals, badges, and leaderboards are operational coaching and recognition tools. They must not:

- make or recommend employment decisions;
- auto-assign shifts or tasks based on a score;
- change compensation, promotion eligibility, discipline, or employment status;
- infer protected characteristics, health, emotion, union activity, or off-duty conduct;
- hide the metric, formula, period, source, or correction path from the affected worker; or
- make missing data look like poor performance.

**Recommendation.** Add a workforce-feature activation gate. Before activation, the customer administrator should identify the purpose, jurisdictions, covered properties/teams, visibility, retention, and whether the feature will affect employment decisions; accept the permitted-use policy; and confirm that required worker notice/consultation has occurred. RepKey should record the policy version and activation actor, not sensitive HR reasoning.

**Decision required.** Counsel must decide whether RepKey is processor/service provider for worker and guest data, which customer is controller/business, the DPA/service-provider clauses, subprocessors, transfer mechanism, and how individual-rights requests flow between customer and RepKey.

## 3. Metric context: make provenance and eligibility first-class

The metric context is the load-bearing seam for dashboard, goals, badges, and leaderboards. A single flat enum plus automatic `metric.recorded` fan-out is insufficient for a product that mixes Google content, public guest interactions, workflow events, and staff performance.

### Recommended metric contract

Each metric definition should declare:

- canonical key and schema version;
- source system and source event;
- property, portal, team, and staff attribution semantics;
- unit and aggregation semantics;
- timezone/calendar rules;
- privacy class and whether it is worker data;
- retention class;
- correction/retraction behavior;
- freshness and completeness status;
- minimum sample/exposure requirements;
- permitted consumers: analytics, goals, badges, leaderboard, notifications, export, AI; and
- policy basis/version for any externally sourced data.

### Proposed eligibility baseline

| Metric family                          | Analytics                                 | Goals                                  | Badges                               | Leaderboard                                       | Rationale                                           |
| -------------------------------------- | ----------------------------------------- | -------------------------------------- | ------------------------------------ | ------------------------------------------------- | --------------------------------------------------- |
| Google review content/rating/count     | Block pending Google permission           | Block                                  | Block                                | Block                                             | API content storage/aggregation policy              |
| External review-link click             | Limited funnel diagnostics                | Never                                  | Never                                | Never                                             | Avoid review-solicitation pressure and staff quotas |
| QR/NFC scan to a review-request portal | Limited traffic diagnostics               | Never                                  | Never                                | Never                                             | A scan is an opportunity, not a service outcome     |
| Private guest rating/feedback          | Property operations with privacy controls | Property/team only after worker review | Possibly non-comparative recognition | Off by default; minimum sample and counsel review | Personal data, bias, low sample, guest abuse        |
| Internal review-response workflow      | Operational/SLA analytics                 | Property/team coaching                 | Carefully selected service badges    | Only after exposure normalization                 | Opportunity volume differs by property/shift        |
| Training or manager-confirmed quality  | Analytics                                 | Potentially eligible                   | Potentially eligible                 | Prefer no ranking                                 | More controllable but still worker data             |

This table is a **recommended product policy**, not a statement that every allowed cell is legally safe in every deployment.

### Corrections and temporal truth

**Recommendation.** Metric readings need a stable source identifier and append-only correction/retraction facts. Reconciliation should reproduce aggregates for a policy/schema version. Team/staff/portal assignment must be resolved as of the event timestamp, not from current membership, so historical results do not move when someone changes teams.

**Recommendation.** Data quality states—`complete`, `partial`, `delayed`, `reconciling`, `invalidated`—should propagate to goals, badges, and leaderboards. Do not award, complete, or rank while required data is partial without showing and recording that state.

## 4. Goals

### Recommended product purpose

Goals should communicate a transparent operational target and progress, not infer employee worth. Property and team goals should be the default. Individual/portal goals should be separately enabled and should never use review-solicitation or Google-derived metrics.

### Required domain improvements

- Separate **progress goals** from **level goals**. A period's accumulated average is not the same as the current external property rating.
- Add goal owner, audience, policy/metric version, baseline, effective period, timezone, eligibility cohort, and visibility.
- Restrict creation and material target changes to managers/admins. Staff may view, acknowledge, and comment; allowing staff to create official performance targets blurs governance.
- Version material changes. Do not silently rewrite target, metric, formula, cohort, or period after progress begins.
- Add `draft → active → completed/expired/cancelled`, plus `invalidated` or `superseded` when data/rules were wrong.
- Completion must be idempotent and reversible as a visible state if the source data is corrected, while preserving an audit fact that completion was previously recorded.
- Explain “current,” “expected,” “remaining,” freshness, and any missing data in plain language.
- Do not send overdue/behind-goal alerts to broad audiences by default.

**Decision required.** Decide whether any individual goals will exist in the first post-beta release. The safest starting point is property and team goals only, with individual goals deferred until customer interviews and a worker/privacy review are complete.

## 5. Teams and staff

Teams and staff assignments define both access control and performance attribution; those concerns should not share ambiguous rows.

### Recommendations

- Represent assignment as an effective-dated relationship with `startsAt`, `endsAt`, role, team, property, portal scope, source, creator, and reason code.
- Separate authorization assignments from analytic attribution. Access may change immediately, but a historical metric should retain the assignment applicable when it occurred.
- Make replacement/move operations transactional and idempotent; retain a non-sensitive history for audit and metric reconciliation.
- Validate that team, portal, property, user, and organization all share the same tenant before any assignment mutation.
- Define a lead lifecycle: lead assignment, replacement, vacancy, and deletion behavior.
- On user departure, revoke access immediately; then apply the retention/anonymization policy to historic activity, goals, badges, and leaderboard data.
- Give each staff member a “How my data is used” view showing sources, current assignments, visible goals/badges, ranking eligibility, and correction/contact path.
- Avoid importing HR attributes not required for the product. Do not store protected-class or medical data in these contexts.

## 6. Badges

The existing immutable-award model is useful as an event ledger but is not sufficient as user-visible truth. Data can be corrected, rules can be defective, eligibility can change, and a data-subject request may require display changes.

### Recommendations

- Preserve the immutable award event, but add visible status: `active`, `revoked`, `superseded`, or `hidden`, with reason, actor, and timestamp.
- Freeze the criteria version, metric version, period, timezone, source completeness, and evidence summary used for each award.
- Make badge definitions centrally governed and reviewable; organizations may enable/disable them but should not create arbitrary worker-surveillance criteria in v1.
- Exclude Google reviews, review-link clicks, scans, review-request volume, named mentions, and conversion-to-review measures.
- Prefer badges for controllable, job-related, non-comparative achievements. Never imply a badge is a certification, HR rating, or guarantee of service quality unless independently substantiated.
- Default badge visibility to the recipient and their authorized managers. Public display and organization-wide announcements require a separate choice.
- Make badge notifications opt-in for email and avoid negative “badge lost” messaging.
- Reconciliation must be deterministic, idempotent, bounded by property, and able to produce an exception report rather than silently changing awards.

**Decision required.** Product should define whether portal-group badges recognize a team, a location zone, or an arbitrary set of portals. The user-facing meaning and eligible audience must be unambiguous before launch.

## 7. Leaderboards

Leaderboards create the highest worker-fairness and dignity risk of these contexts. A “staff portal” makes a portal leaderboard an individual ranking even if the database target type says `portal`.

### Recommendations

- Ship leaderboards disabled by default and activate them only after the workforce-feature gate.
- Keep them private to one property or comparable team; never expose a public or cross-customer leaderboard.
- Do not include `all_time` in the first release. Use bounded periods and expire snapshots under the retention schedule.
- Suppress ranks for small cohorts and low samples. Candidate product defaults are at least five eligible peers and at least ten relevant observations per target; validate these empirically and with counsel rather than presenting them as statistical guarantees.
- Compare like with like. Use exposure denominators or target attainment where opportunity volume differs. Raw scan, click, feedback, or review counts should not rank people.
- Continue to avoid a hidden composite score. Show the metric, unit, period, timezone, inclusion rules, minimum sample, calculation version, freshness, and missing-data status.
- Treat maximum-value normalization cautiously: a person's displayed score changes when a peer changes and rewards volume. Prefer direct units, documented rates, or progress against an agreed target.
- Give affected workers access to the underlying eligible facts and a correction route.
- Use ties honestly; never add arbitrary tie-breakers that imply precision the data does not support.
- Avoid red/green labels such as “worst performer.” Use neutral ranking and “insufficient data” language.
- Do not email rank changes or “bottom performer” alerts by default.
- Record who enabled the leaderboard, its intended purpose, audience, policy version, and expiration/review date.

**Decision required.** Decide whether individual leaderboards deliver enough customer value to justify the privacy/fairness burden. A lower-risk alternative is a property/team improvement dashboard with no ordinal ranking.

## 8. Public property portals and guest feedback

### 8.1 Review-neutral guest journey

**Vendor and legal basis.** Google prohibits discouraging negative reviews and selectively soliciting positive reviews. The FTC rule prohibits specified deceptive review practices and review suppression. [Google Maps policy](https://support.google.com/contributionpolicy/answer/7400114?hl=en), [FTC review rule](https://www.ftc.gov/legal-library/browse/rules/rulemaking-use-consumer-reviews-testimonials)

**Recommendation.** Remove rating-dependent “smart routing” from the initial public flow. The same external review choices, order, size, contrast, copy, and number of steps should appear for every private rating. Private feedback can be offered to everyone with identical prominence. Automated UI tests should compare the low- and high-rating render trees and screenshots for parity.

**Recommendation.** Clearly label the two actions:

- “Send private feedback to this property” — not publicly posted; and
- “Leave a public review on [provider]” — opens the provider and is subject to its account/policies.

Do not imply private feedback will create, suppress, or replace a public review.

### 8.2 Public endpoint and abuse controls

**Official guidance.** OWASP API4 identifies missing time, memory, payload, pagination, request-rate, and third-party-spend limits as unrestricted resource-consumption risks. [OWASP API4:2023](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)

**Recommendation.** Apply layered budgets rather than a single IP limit:

- edge/WAF limit by trusted client address and route;
- per-portal and per-property budgets;
- server-issued, signed, expiring guest-session or submission token;
- one rating/feedback mutation per valid interaction, with idempotency;
- separate stricter budgets for feedback, redirect tracking, and upload-related actions;
- bounded payload length and Unicode normalization;
- bot challenge only after risk signals, with an accessible alternative;
- anomaly and cost alerts; and
- a fail-closed or degraded behavior for write endpoints when the shared limiter is unavailable.

IP address, hashed IP, user agent, session identifier, and free text can be personal data. Hashing is pseudonymization, not an automatic exemption from privacy law. Retain the least data needed for a defined abuse purpose and keep it out of analytics and employee ranking.

### 8.3 Cookies and local storage

**Legal requirement where applicable.** The EU ePrivacy framework requires information and consent for storage/access on a user's device unless an exemption applies; UK guidance similarly distinguishes strictly necessary technologies from helpful analytics. [ePrivacy Directive Article 5(3)](https://eur-lex.europa.eu/eli/dir/2002/58/art_5/par_3/oj/eng), [ICO cookies and similar technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/)

The EDPB's final Guidelines 2/2023 explain that Article 5(3)'s technical scope is broader than conventional HTTP cookies, covering relevant storage/access techniques. The inventory must therefore include local storage, SDK/device access, tracking pixels, link decoration, and similar mechanisms—not only rows named “cookie.” [EDPB Guidelines 2/2023](https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en)

**Recommendation.** Maintain a cookie/technology inventory with purpose, provider, field contents, duration, region, and legal classification. Do not set analytics or attribution cookies before valid consent in jurisdictions that require it. Determine with counsel whether the guest session is strictly necessary for the user-requested submission or mainly serves property analytics/abuse prevention. Even exempt cookies need clear notice.

**Security recommendation.** Any session identifier should be server-issued, unpredictable, validated, rotated where appropriate, and sent using `Secure`, `HttpOnly`, and an intentional `SameSite` policy. Do not trust a client-generated cookie as proof of a prior visit. [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

### 8.4 QR, NFC, and links

**Recommendation.** A QR code or NFC tag should contain only a canonical HTTPS public URL and an opaque, revocable campaign/tag identifier. It must not contain secrets, user IDs, staff names, authorization state, or a raw destination URL.

- Treat `source=qr|nfc|direct` as untrusted attribution, never authorization.
- Resolve destinations server-side from an allowlisted record. Do not implement an arbitrary open redirect; OWASP recommends an allowlist or server-side destination identifier. [OWASP Unvalidated Redirects and Forwards Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html)
- Print the property identity and a human-readable short URL beside every code so a damaged/unscannable image does not block access.
- Give properties physical guidance for detecting/replacing tampered stickers. The FTC warns consumers that attackers can cover legitimate QR codes with their own and recommends inspecting the destination before opening it. [FTC QR-code consumer alert](https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information)
- Support tag rotation/revocation without changing the public portal identity.
- Record only the minimum campaign attribution necessary and do not use it as a staff quota.
- If a native app is introduced, use verified Apple Universal Links or Android App Links rather than custom schemes. [Apple associated domains](https://developer.apple.com/documentation/Xcode/supporting-associated-domains), [Android App Links](https://developer.android.com/training/app-links/about)

### 8.5 Guest privacy and moderation

**Recommendation.** The public notice should identify the property/customer as controller where applicable, RepKey's role, data collected, purpose, recipients, retention, transfers, contact/rights route, and whether private feedback is visible to named staff. Do not claim that “no personal data” is collected when identifiers or free text are processed.

Free-text feedback should warn users not to include payment card, passport, medical, or other highly sensitive information. Define a route to report unlawful or abusive content, restrict staff visibility by property and need, and support deletion/redaction without corrupting aggregate counts.

## 9. Activity, security audit, and notification preferences

### 9.1 Separate activity from audit evidence

**Official guidance.** OWASP recommends recording security-relevant authentication, authorization, administrative, configuration, consent, import/export, upload, and suspicious-flow events while excluding or masking credentials, session IDs, tokens, secrets, and unnecessary sensitive personal data. Logs need restricted access, tamper protection, monitoring, and a defined disposal schedule. [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

NIST SP 800-92 provides the corresponding official log-management framework for log infrastructure, policies, processes, and operational responsibilities. It is an engineering reference rather than a universal legal retention mandate. [NIST SP 800-92](https://csrc.nist.gov/pubs/sp/800/92/final)

**Recommendation.** Use two explicit models:

| Model                     | Purpose                                          | Audience                              | Payload and lifecycle                                                                                    |
| ------------------------- | ------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Product activity          | Explain collaboration and resource history       | Authorized product users              | Human-readable, property/resource scoped, redactable/tombstonable, shorter retention                     |
| Security/compliance audit | Investigate access, policy, and external effects | Restricted operators/compliance roles | Stable event schema, actor/tenant/target/result/correlation, tamper-evident controls, separate retention |

The product activity feed should not be described as a complete audit log. Conversely, security logs should not be exposed as a social activity feed.

**Recommendation.** Extend coverage to authentication outcomes, membership/role changes, staff/team/portal assignments, goal creation/material changes, badge/leaderboard activation and policy changes, portal publication, link/QR changes, upload validation, Google connect/disconnect and external writes, exports, privacy requests, and destructive lifecycle actions. Do not copy review text, guest feedback, email bodies, tokens, cookies, or presigned URLs into event payloads.

### 9.2 Notification channel policy

**Legal requirement where applicable.** In the US, CAN-SPAM treatment depends on the email's primary purpose. Transactional or relationship messages are narrowly defined; mixing promotion into operational messages can change the classification. In Europe, direct-marketing email is subject to ePrivacy/GDPR rules and national implementation. [FTC CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business), [ePrivacy Directive Article 13](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02002L0058-20060503)

**Recommendation.** Keep product notifications operational and marketing-free. Establish categories:

- mandatory account/security/legal notices;
- urgent operational failures requiring action;
- workflow notifications;
- daily/weekly summaries; and
- recognition/gamification.

Users should control email for workflow, summaries, and recognition. In-app may default on, but badge and leaderboard email should be opt-in. Mandatory security/account notices can be non-disableable but must be narrowly defined and documented.

**Recommendation.** Replace “missing preference means both channels on” with an explicit, versioned default policy. Record preference changes in security audit without logging message content. Provide one-click access to preferences from every non-mandatory email.

**Recommendation.** Digest scheduling should primarily follow the recipient's timezone and quiet hours. A user assigned to several properties should not receive several duplicated digests solely because those properties use different timezones.

**Vendor-operation recommendation.** Resend supports 24-hour idempotency keys and signed webhooks for delivery, bounce, complaint, delay, and failure events. RepKey should retain its own durable send intent/idempotency record beyond the provider's short deduplication window, persist provider message IDs, verify raw-body webhook signatures, deduplicate provider event IDs, and maintain local bounce/complaint suppression. [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), [Resend webhook event types](https://resend.com/docs/webhooks/event-types), [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [Resend suppressions](https://resend.com/docs/dashboard/emails/email-suppressions)

## 10. Safe portal image uploads

**Official guidance.** OWASP recommends extension allowlists, independent MIME/signature validation, server-generated filenames, size limits, authorization, private/out-of-webroot storage, safe image rewriting, and layered controls. AWS describes presigned URLs as bearer capabilities that may be reused until expiry and supports restricting signature age and verifying checksums. [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [AWS presigned URL documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

### Recommended upload state machine

`requested → uploaded_to_quarantine → verified → processing → ready | rejected | expired`

Controls:

- Authorize the exact organization, property, portal, upload ID, object-key prefix, method, short expiry, declared maximum size/type, and checksum before issuing a presigned capability.
- Treat the client-declared content type and size as hints only.
- `finalize` accepts an upload ID, not an arbitrary object URL/key. It verifies ownership, expected key, object metadata, size, checksum, and state.
- Keep originals private in a quarantine prefix. The worker reads the exact internal S3 key; it must not fetch a user-influenced public URL, avoiding an SSRF seam.
- Apply encoded-byte, decoded-pixel, dimension, frame/page, processing-time, and memory limits. Detect type from content, decode, rewrite to approved formats, strip metadata, and generate named variants.
- Publish only rewritten variants using generated names and correct `Content-Type`/cache headers. Never publish the original upload.
- Delete rejected/expired quarantine objects promptly and configure an incomplete-upload lifecycle. AWS recommends completing or aborting multipart uploads because incomplete parts continue to consume billed storage. [AWS abort multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/abort-mpu.html)
- Deleting or replacing a portal image should enqueue idempotent cleanup for original/quarantine/variant keys and leave an audit event without the presigned URL.

## 11. Accessibility and performance

### 11.1 Accessibility

**Standard target.** WCAG 2.2 is the current W3C Recommendation. A Level AA claim requires every applicable Level A and AA criterion across complete pages and processes, not merely a successful automated scan. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

**Recommendations by surface:**

- Public portal: semantic headings/landmarks, visible labels and errors, keyboard operation, 200% text resize, reflow, focus visibility/not-obscured, 24-by-24 CSS pixel minimum targets where WCAG 2.2 AA applies, status messages, and locale/language metadata.
- Rating: use native radio inputs or the WAI radio-group pattern with a visible group label and full keyboard behavior; W3C provides a specific five-star rating example. [WAI rating radio-group example](https://www.w3.org/WAI/ARIA/apg/patterns/radio/examples/radio-rating/)
- Theming: reject or automatically correct customer color combinations that fail 4.5:1 text contrast and applicable 3:1 non-text/UI contrast. Never use color alone for rank, pace, award, status, or validation.
- QR: provide meaningful text alternative and a visible typed URL; WCAG requires equivalent text alternatives for non-text content. [W3C Understanding 1.1.1](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)
- Leaderboards: use a semantic table/list, textual ranks and ties, clear headers/captions, and a non-chart explanation. Do not rely on red/green heat maps.
- Goals: charts require an accessible name, summary, and equivalent tabular/key-value values. Progress updates must not repeatedly steal focus or flood live regions.
- Portal configuration: every drag/reorder interaction needs a non-drag alternative under WCAG 2.2 dragging-movement requirements.
- Motion: respect `prefers-reduced-motion`; recognition animation must never be required to understand the award.

Validation should combine automated axe/Storybook checks, keyboard testing, screen-reader testing, zoom/reflow, high-contrast/forced-colors checks, and representative mobile devices.

### 11.2 Performance

**Official guidance.** Google's “good” Core Web Vitals thresholds at the 75th percentile are LCP ≤2.5 seconds, INP ≤200 milliseconds, and CLS ≤0.1. [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)

**Recommendation.** Make the public portal a separate performance budget:

- minimal client JavaScript and no authenticated-app bundle;
- server-rendered primary content;
- responsive rewritten image variants with dimensions reserved;
- self-hosted/subset fonts or a tested system stack;
- no third-party trackers before consent;
- CDN caching for public configuration with short, versioned invalidation;
- `no-store` for private feedback responses and any page containing sensitive state; and
- field telemetry segmented by device, country/region, portal, and release without collecting guest text or persistent cross-site identifiers.

Define lab budgets in CI, but use field 75th-percentile data for the product objective.

## 12. Lifecycle and retention

**Legal/vendor basis.** GDPR requires purpose limitation, data minimization, accuracy, storage limitation, rights handling, and privacy by design/default. CCPA provides access/knowledge, deletion subject to exceptions, correction, and notice rights when applicable. Google imposes the stricter 30-day/no-aggregation rule for API content. [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [California CCPA overview](https://oag.ca.gov/privacy/ccpa), [Google API policy](https://developers.google.com/my-business/content/policies)

### Required lifecycle properties

- Every table/data class has an owner, purpose, subject type, source, region, legal/policy basis, active retention, deletion/anonymization action, backup expiry, and legal-hold behavior.
- Property, portal, team, and staff removal is an orchestrated workflow: immediately disable access/publication, stop new jobs, revoke external grants where required, then delete/anonymize dependent data and objects with retries and evidence.
- Soft deletion is not retention compliance. A scheduled purge/anonymization process must reach rows, materialized views, snapshots, queues, search/cache, object storage, telemetry, and backups according to policy.
- Data-subject correction/deletion must propagate to visible activity, goals, awards, and rankings without rewriting restricted security evidence improperly. Use tombstones/pseudonymization where retention is justified.
- Backups need a documented “deleted data may persist until backup expiry and will not be restored into active use” procedure.

### Candidate product defaults for planning

These are **recommendations for discussion, not source-mandated periods**. Counsel and customer contracts must validate them before adoption.

| Data class                              | Candidate active retention/action                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GBP API review content                  | Maximum 30 days and no derived aggregate under published policy; shorter if not operationally needed |
| Raw guest private feedback              | 180 days, then delete or customer-configured shorter period                                          |
| Raw guest scan/click/rating events      | 13 months, then aggregate/anonymize where lawful; exclude Google-derived data                        |
| Metric readings used for coaching       | 13 months; corrections retained as non-content evidence for the same window                          |
| Goal definitions and outcomes           | Active plus 24 months, then anonymize/delete unless customer policy requires less/more               |
| Leaderboard snapshots                   | 13 months maximum; no all-time snapshot                                                              |
| Visible badge status                    | Account lifetime or 24 months after award, with hide/revoke/correction support                       |
| Product activity feed                   | 12 months                                                                                            |
| Restricted security audit               | 24 months, subject to security/legal need and customer contract                                      |
| In-app notifications and delivery queue | 90 days after terminal state; retain minimal aggregate delivery evidence longer only if justified    |
| Original/quarantine upload              | Delete after successful processing or within 24 hours; rejected/expired objects purged automatically |
| Published image variants                | Until replacement/portal deletion plus a short recovery grace period                                 |

## 13. Decisions requiring counsel and product leadership

1. **Google disposition:** What exact persistent storage, transformations, aggregates, AI processing, and derived features does Google permit in writing?
2. **Review-neutral portal:** Will product remove rating-dependent smart routing entirely? This is the recommended answer.
3. **Permitted workforce use:** Will contracts and UI prohibit employment decisions, pay, discipline, scheduling, and promotion use? This is the recommended v1 boundary.
4. **Individual leaderboards:** Are they valuable enough to justify the privacy, fairness, consultation, correction, and support burden?
5. **Individual goals:** Launch property/team goals first, or permit individual/portal goals with extra activation controls?
6. **Worker notice:** Who delivers/records required notices and consultation—the customer, RepKey, or both—and what evidence is retained?
7. **Roles and contracts:** Controller/processor/service-provider allocation for account, worker, guest, and Google data; DPA; subprocessors; transfers; government-request policy.
8. **Jurisdiction matrix:** Which US states and European countries are enabled at each rollout stage, and what local employment/privacy consultation is required?
9. **Cohort/sample defaults:** Minimum peers, observations, exposure denominators, and suppression behavior for any comparison.
10. **Visibility:** Who may see individual goals, badges, rank, private feedback, and correction requests?
11. **Retention:** Approve or replace the candidate schedule and define legal hold, termination, backup expiry, and customer-configurable bounds.
12. **Cookie classification:** Is each portal cookie/storage technology strictly necessary, consented analytics, or removable?
13. **Guest moderation:** Which customer/RepKey roles handle abusive, unlawful, or sensitive feedback and within what SLA?
14. **Accessibility claim:** Commit to WCAG 2.2 AA as an engineering target, a contractual claim, or both; formal claims require complete evaluation evidence.
15. **AI separation:** Ensure future review AI cannot silently become employee scoring; any such use gets a new DPIA/AIA, fairness validation, and legal release gate.

## 14. Recommended planning sequence

1. Resolve Google policy and freeze prohibited metric consumers in code.
2. Create the metric registry, provenance, correction, eligibility, and retention model.
3. Create the workforce permitted-use policy, activation gate, transparency view, and DPIA/AIA template.
4. Make team/staff assignment temporal and distinguish access from metric attribution.
5. Rebuild goals on versioned metrics and launch only property/team scope initially.
6. Rebuild badges with correctable visible state and an approved criteria catalogue.
7. Decide whether to replace individual leaderboards with non-ranked team improvement views; if retained, add cohort, opportunity, sample, explanation, correction, and visibility safeguards.
8. Rebuild the public portal as a review-neutral, consent-aware, rate-limited public boundary with secure QR/NFC links.
9. Implement the quarantined image-upload pipeline.
10. Separate product activity from security audit and complete notification preferences.
11. Implement lifecycle orchestration and evidence across database, queues, storage, caches, telemetry, and backups.
12. Prove accessibility, mobile performance, security, fairness, privacy, and policy compliance in a controlled pilot before wider activation.

## Source maintenance

Vendor policies, state privacy/employment rules, and the EU AI Act implementation schedule can change. Re-check Google policy, FTC materials, enabled-state laws, EU/UK regulator guidance, and the final applicable AI Act timeline at each release gate. Record the URL, retrieval date, policy version/date where available, reviewer, and resulting product-policy version.
