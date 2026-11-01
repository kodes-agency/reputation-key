---
status: accepted
date: 2026-11-01
---

# 0076 — Staff accounts and personal Portals

Staff could be attributed to a Portal but could not sign in. On 2026-11-01 the
owner decided to build the part of the product that was still missing: a
receptionist has an account, shows guests a code from her own phone, and sees how
that code is doing. This amends [ADR 0033](0033-authorization-policy.md),
[ADR 0049](0049-beta-local-acceptance.md),
[ADR 0052](0052-beta-people-access-attribution-and-manager-responsibility.md),
[ADR 0064](0064-sealed-portal-address-and-download-again.md) and
[ADR 0068](0068-monthly-portal-goal.md). The plan and every decision are in
`docs/plan/staff-accounts.md`.

## Decision

### A person has a personal Portal

1. A staff member has one **personal Portal** per Property they work at: a full
   Portal, published, with its own code. `portals.kind` is `place` or `personal`,
   set at creation and never changed. `staff_participations.personal_portal_id`
   names it. Credit needs nothing new: the person is the Portal's Primary, so
   `resolvePrimaryStaffAttribution` credits them as it credits anyone.
2. A personal Portal never changes hands, and its Primary cannot be changed from
   the Staff page. It ends with its person.
3. **Guests never see the person's name.** `portals.name` holds the person's name
   for managers; `portals.public_name` is what every guest-facing surface uses
   (the published snapshot, the page head, link previews, the older page's heading,
   print kit titles and file names). The slug is opaque. A manager cannot type the
   person's name into that Portal's public text.

### A separate door

4. The manager gate does not change: `resolveTenant` still refuses the `member`
   token. A staff-only login therefore reaches no existing server function, whatever
   that function's permission check says.
5. Staff reach a small set of `staff.self` server functions through their own
   resolver. It requires a session, the one Organization membership, an active
   `StaffUserLink`, and the execution policy's decision on `staff.self` under the
   capability `staff.accounts`. Suspension and the kill switch apply as they do to
   everyone. The person is always read from the session; no input names them.
6. `StaffUserLink` becomes live. It lets a person read their own code and results
   and nothing else. It still grants no Property access, and it is still not read
   for command authority or manager eligibility (ADR 0052).
7. The `member` role loses everything except its own password, profile and
   `staff.self`.
8. A login may be both a manager and staff, and staff may work at several
   Properties. A manager's login is never ended by removing their staff role.

### Adding and removing

9. **Add staff** is one step: rows of name and email, up to 20, one Portal to copy
   for the batch. It creates the person, the Portal, the code and the publication,
   then invites them. Portal and Identity commit separately and an email is sent
   after the commit, so each row is a stored `staff_onboardings` operation with
   stable identifiers: a failure stops at its step, and a retry resumes. Rows are
   checked before anything is created. A source Portal with unpublished edits is
   refused, so an unreviewed edit is never published by a copy.
10. **AccountAdmins, and PropertyManagers at Properties they can work,** may add
    and remove staff. This narrows ADR 0033 for one role: a PropertyManager still
    invites nobody else and cannot create a manager.
11. Invitation acceptance creates the link in the same transaction as the
    membership, on every acceptance path. A staff invitation grants no Property
    access.
12. **Remove** is one action: it cancels a pending invitation, ends the
    participation, responsibility and (with the person's last Property) link, and
    archives the Portal, so its code stops working. A staff-only login that loses
    its last Property loses its membership and its sessions. History stays. A person
    who comes back gets a new Portal. A PropertyManager may archive a personal
    Portal only through Remove, and Restore does not bring one back.

### What people see

13. **Code.** The staff screen opens on the code and shows nothing else on that
    tab. Reading the code needs no edit permission and has its own budget (amends
    ADR 0064). A Portal that cannot take guests shows as paused. Staff screens have
    no link that opens the guest page on the staff member's phone.
14. **Results.** Scans are live. Rating count and average cover this week and this
    month up to last midnight in the Property's time zone, and none for today, so a
    rating cannot be watched arriving; the average appears from 5 ratings. Staff never
    see private notes or Google opens.
15. **Colleagues.** An AccountAdmin may turn on a list of the Property's staff with
    their scan counts: scans only, in name order, off by default. Nothing ranks people,
    in this list or anywhere else. `gbp.review_solicitation_gamification` stays
    `permanently_denied`.
16. **Managers** see every measure of a person's Portal, including guests who opened
    Google. In the Portals list, people fold under their Group and stay in name order
    whatever the sort, so a sort cannot rank them; people with no Group sit under
    "Other staff". A hint marks a high rating from few guests, for a conversation and
    with no consequence.

### Scan targets

17. A manager may set a target on a person's Portal, or on a Group holding one. It
    counts `qualified_scans` and nothing else, and the staff member sees it. It is
    refused on a Portal that skips the private rating (ADR 0044, amendment
    2026-11-02). No Google fact and no rating drives a target on a person. This
    narrows ADR 0049 rule 2 and the "No staff goal" line of ADR 0068 for that one
    measure. Every other rule stands: no ranking, no reward, no automatic consequence,
    `employment_decision_eligible` false, and the Property Google rating goal is still
    never split or shown to staff.
18. Targets have their own switch, `STAFF_SCAN_TARGETS_ENABLED`. Off, no new target
    can be set and staff see none.

### Google

19. Google's Maps policy says merchants may not ask staff to solicit "a certain
    number of reviews", may not "selectively solicit positive reviews", and may not
    "require or pressure users to leave ratings or write reviews while on the
    premises". Nothing here asks for a review count, but a scan is an invitation to
    review. The owner weighed this on 2026-11-01 and kept scan targets with these
    safeguards: staff are told at first sign-in to offer the code to every guest and
    never to ask for a good rating or a mention; the Agreement binds the business not
    to reward staff on ratings, review numbers or scan targets; and the hint in 16 is
    a real check. The owner is putting the design to Google in writing.

## Consequences

- `staff.accounts` is `beta_disabled` until the last pull request of the plan, which
  makes it `controlled_beta` with the published documents and the What's new entry.
- Person-level reads of Guest facts are worker data; `docs/security/data-inventory.md`
  says so, under the same 24 months as the facts they read.
- Visits from a browser signed in to the Portal's own Organization are not counted,
  so a manager's or a staff member's own test does not move a number.
- The dormant `get-staff-dashboard-data.ts`, which read Property-wide Google numbers
  for a Member, is deleted.

## Rejected alternatives

- A personal code on one shared Portal. It keeps managers to one Portal, but the owner
  preferred each person to have a real Portal.
- Letting `member` through `resolveTenant` and relying on each function's permission
  check. Members held `review.read`, `inbox.write` and `dashboard.read`, and no
  function was written with a staff login in mind.
- A ranked leaderboard. Refused for the reasons in 19.
- Copying a Portal's published snapshot back into a working copy. Refusing a source
  with unpublished edits gives the same guarantee with far less code.
