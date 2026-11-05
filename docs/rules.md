# Engineering rules

These rules apply to engineers and AI sessions. External commitments and the
[closed beta obligations](obligations.md) take precedence. The
[architecture map](../ARCHITECTURE.md) and [ADR index](adr/README.md) locate
current decisions. The [standards reference](standards.md) still supplies
implementation details and naming conventions used by existing tools.

## Scope and delivery

1. Keep reachable features. Low usage is no reason to remove one. Add no feature,
   capability, flag, table or environment variable without explicit authorization.
   Contact requests are an authorized freeze exception; guest photos remain later
   work and their consent field stays dormant.
2. Every change simplifies a real responsibility, repairs a defect or delivers an
   authorized prerequisite. Explain the resulting behaviour and what obsolete
   mechanism can go. Line totals are estimates, never acceptance gates. Files
   remain subject to the 800-line limit.
3. Use one active implementation stream per owned area. Reserve shared files
   with their owner and respect dependencies.
4. Keep strict branch protection and one serial merge line: update one ready
   change, wait for checks and independent review, then merge. Allow one automatic
   rerun before investigating a failed run. Red main pauses deployment and new
   implementation until fixed or reverted that working day. Deploy proven commits
   in batches; each destructive or irreversible step deploys alone with owner
   approval. Recovery after applied migrations remains forward-only.
5. No destructive migration or irreversible data operation precedes verified
   backups, a passing isolated restore and owner approval. Destructive migrations
   also need migration immutability, populated upgrade checks and fresh counts.
   A contraction waits until the reader-removal release runs on both web and
   worker, verified at deploy preflight. Irreversible work needs a read-only trial,
   bounded resumable batches and applicable journal replay proof. First activation
   of journal-dependent erasure needs command-level replay proof and backups
   within 30 days, including Manual backups. The owner approves that activation
   once; later scheduled age-based retention runs automatically. Separate one-off
   erasures still need approval. Do not repeat a passing owner restore rehearsal.

## One authority and one implementation

6. Define each rule once. Generate other representations or test them against the
   authority. Do not maintain hand-copied lists that must agree.
7. Give every central schema file and table one owner. Write through named
   commands; a workflow requiring one transaction has one transaction owner.
   Review and Inbox may merge with that simplification; other merges need their
   own reason.
8. Read across features through named reads or explicit browser-safe contracts.
   Do not import another feature's internal store. Keep browser contracts, server
   calls and screens in separate entry files without catch-all barrels.
9. Delete replaced code only after cutover proof. Prove no callers through the
   import graph, including barrels, rather than by searching a filename. Remove
   obsolete generation labels while retaining meaningful stored-format,
   provenance and issued-address versions. Keep server-function paths fixed.
10. Allow one unfinished replacement per area, with an owner, cutover check,
    date and contraction step before widening it.
11. Merge code that can run within 30 days unless explicitly authorized to remain
    dormant. Temporary flags have removal dates. The target operational switches
    are Google calls, AI calls, Guest pages and Optional email. Everything-off,
    Organization suspension and merchant per-Property AI consent remain. Retire
    finished own-look and staff rollout switches after their completed checks;
    keep the features. Contact requests use a short-lived flag; media consent
    stays dormant. Existing controls remain until their replacements are proven.

## Code and ownership

12. Prefer plain functions and files with clear jobs. Use feature folders inside
    `src/contexts/<area>/` and screens in `ui/` after assessing the Portal results
    pilot. Move a file only when also simplifying it. Adopt `*.server.ts` before
    dissolving protected layer folders. Keep schema in `src/shared/db/schema`,
    shared infrastructure in `src/shared/`, and server functions at current paths.
    If the pilot fails, simplify today's layers. A newcomer should be able to
    follow a route to SQL without tracing forwarding layers.
13. Keep interfaces for real providers, real alternative implementations or fakes
    that exercise real decisions.
14. Wait for three real uses before introducing a framework. Prefer two small
    concrete implementations to a speculative abstraction.
15. Constructors assemble dependencies; business decisions live elsewhere.
16. Make no network call inside a database transaction. Write a required bucket
    journal object before entering a deletion transaction.
17. Comments explain reasons, invariants and contracts. Remove restated code and
    historical narration as code is touched. Preserve ADR-number references
    through the index rather than bulk rewriting them.
18. Split files when responsibilities separate. Components share the 800-line
    file limit with other code.

## Data and failures

19. Enforce tenant isolation through restricted roles and transaction-scoped
    tenant context. Introduce the owner, application and worker-only system roles,
    observe for a week and measure heavy-page overhead before enforcing row-level
    security in three waves. Keep current protections during rollout. Named system
    executors are worker-only and reviewed. Retire the old scanner only after the
    full rollout and observation conditions pass.
20. Database constraints check data shape. Keep product copy and policy wording
    out of DDL.
21. Expand, migrate and contract separately. Applied migrations stay immutable
    until a final baseline is proven on a restored copy. Bound locks and backfills,
    add constraints online, run populated upgrade checks and serialize migrations.
22. Declare each table's lifetime beside its centrally owned schema. Schedule
    retention, record outcomes and alert on overdue work. Write an IDs-only
    journal object before each erasure that would not repeat after restore; failed
    writes block deletion and alert. Use the existing bucket with 45-day expiry
    and no hash chain. Age-based cleanup reruns after restore. Keep backups within
    30 days. Disconnect and lapse neither erase early nor reset existing expiry.
23. Queue acceptance starts work. Keep durable due time, outcome and a visible
    stuck state until completion.
24. A timeout stops or isolates work. Do not release capacity while a handler
    continues running.
25. Read back an uncertain external write. Never resend it automatically.
26. Give global loops bounded progress and tenant fairness. One tenant's held or
    failing rows cannot block another tenant's work.
27. Log allowlisted fields. Never flatten errors into strings or include SQL
    parameters, secrets or customer content.

## Verification

28. Test public commands through real PostgreSQL by default. Fake provider
    transport, clock and randomness. Keep independent model tests and unique
    behavioural proofs preserved by replacements.
29. Every test fails for a named behavioural reason. Avoid source-spelling,
    class-name and document-wording assertions. Retain focused import-boundary
    tests, published legal-document checks and documentation link/command checks.
    Prove the five retained UI rules in existing lint before removing their scans.
30. Write acceptance examples before implementation. A separate Codex review
    checks preserved behaviour. The owner reviews new customer-visible outcomes,
    real product choices and irreversible steps. A separate session writes critical
    black-box tests from examples without seeing implementation. Answered choices
    do not require another approval ceremony.
31. Sample mutations monthly for critical tenant policy, attempt fences and period
    clocks. Checks must catch their named faults.
32. Check independent reality: a built artifact, migrated database, restricted
    role or observed outcome. Source-line totals cannot gate completion; file
    length limits and approved bundle byte budgets remain enforced.
33. Prove each gate can fail with a planted fault. UI states use real CSS,
    accessibility and shared phone-width checks for sideways overflow and 44 px
    targets. Keep both path-scoped guest suites and the same-Google-action unit
    proofs.
34. Add a gate only after removing one or explaining why structure cannot enforce
    the requirement. Assess Portal results before widening layout or browser-test
    changes. Storybook retires only after the pilot catches the same faults, is no
    harder to read, is no slower and the last state and guest check are converted.
    Test-line differences are information only. Use existing lint, without another
    boundary tool.

## Documentation and completion

35. Keep active README, ARCHITECTURE, rules, triage, short area maps, operations,
    rights-request procedures, incident lessons, obligations and the ADR index.
    Preserve legal documents, Google correspondence, test-pinned security
    inventory, PRODUCT and LICENSE. Retarget executable readers before removing
    their documents. Archive retired text behind protected `docs-archive-*` tags;
    the index records locations. Word-count figures are estimates, not gates.
36. Keep programme plans, journals and agent notes outside the product repository.
    Issues hold the queue and git holds history. Public descriptions carry no
    exploit details. Complete outstanding launch obligations before outside access
    or customers.
37. Write for people without chat history. Building, testing and understanding
    the application must not require an AI tool, personal configuration or a
    particular machine.
38. Done means behaviour is wired, scheduled where needed, recoverable, tested
    and deployed through the supported path. Remove replaced writers and callers,
    update the map and prove applicable denials, retries and retention. A library
    without its required entry point is incomplete. Line totals do not define done.
