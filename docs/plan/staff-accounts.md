# Staff accounts: plan

Date: 2026-11-01. Status: in build. Owner decisions from a grilling session, recorded in [ADR 0076](../adr/0076-staff-accounts-and-personal-portals.md). The owner's binding log is `~/kodes/staff-dashboard-2026-11-01/DECISIONS.md`; the Google research is `google-policy-notes.md` beside it.

## What changes

A receptionist has an account. On her phone she opens a code guests scan, and one tap away she sees her scans, her ratings and any scan target her manager set. A manager adds staff in a batch, and sees them folded under their Group in the Portals list. Nothing else in the app is open to her.

## Owner decisions

| Id       | Decision                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1       | Comparison is a plain list: scans in name order, no positions. Off by default, an AccountAdmin turns it on per Property. No ranked leaderboard, prizes or badges.                                 |
| D2       | One full Portal per person.                                                                                                                                                                       |
| D3       | One "Add staff" step: rows plus paste, up to 20 at a time, one Portal to copy per batch; result per person.                                                                                       |
| D4       | AccountAdmins anywhere, PropertyManagers at Properties they can work, staff role only.                                                                                                            |
| D6       | Guests never see the person's name.                                                                                                                                                               |
| D7, D8   | Staff see scans (live), rating count and average (this week and this month, up to last midnight; none for today; average from 5 ratings).                                                         |
| D9       | One Remove action. Sign-in ends if it was a staff-only login's last Property, the Portal is archived, history stays. Coming back means a new Portal.                                              |
| D10, D11 | Staff Portals are in the Portals list and can join Groups. People fold under their Group and stay A to Z whatever the sort. No Group: "Other staff".                                              |
| G4       | Scan targets only: a manager may set one on a person's Portal or a Group holding one; staff see it. Never on ratings, never on a Portal that skips the private rating. It has its own off switch. |
| D14      | Managers see Opened Google per person. Staff do not.                                                                                                                                              |
| D15      | The colleague list is all staff at the Property.                                                                                                                                                  |
| D16      | Staff screen: two tabs, Code (nothing else on it) and My results. A web page that can be added to the home screen.                                                                                |
| D17, G5  | A short notice once at first sign-in carries the rules; everyday screens carry no instructions. The Agreement binds the business. A manager-only hint marks a high rating from few guests.        |
| D18      | Updated legal documents take effect on release, no waiting period (both beta Organizations are the owner's).                                                                                      |
| D19      | A login can be a manager and staff; staff can work at several Properties. Managers get "My code" in the manager app.                                                                              |
| D20      | English for now. Guest-facing words on the Code tab follow the Portal's language.                                                                                                                 |
| D21, G2  | Separate feature: a per-Portal switch skips the private rating and shows the Google button, allowed on any Portal. Falls back to the rating form if Google's link fails.                          |

Defaults the owner accepted: a manager cannot move a person to another Portal; someone who has not accepted stays visible with Resend, and Cancel is Remove; they join the colleague list only after accepting; a Portal offline or a Property archived keeps the person's account and history and the Code tab says paused; a person's numbers follow the 24-month rule of the facts they read; staff Portals count in Monthly goal recommendations; "no scans lately" hints are for managers only; a manager cannot type the person's name into that Portal's public text; visits from a browser signed in to the Organization are not counted; weeks start Monday, Sunday for US Properties; staff get no notifications; a What's new entry for managers follows.

## Pull requests

| PR  | Contents                                                                                                                                                                               | Notes                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A   | Skip-rating switch                                                                                                                                                                     | Independent, ships first                         |
| B   | Foundation: the staff door, permissions, data model, Add and Remove use cases, the reads, guest-name separation, this plan and ADR 0076                                                | No UI. `staff.accounts` stays `beta_disabled`    |
| C   | Manager side: Add staff, Portals list, Remove, Resend, colleague switch, scan targets, the hint, Monthly goal line                                                                     | Depends on B. Hidden while the capability is off |
| D   | Staff side: Code, My results, notice, My code, manifest, screen wake. Turns `staff.accounts` to `controlled_beta`, with the legal documents, the journey test and the What's new entry | Depends on B. Merges last                        |

## Owner action

Send `~/kodes/staff-dashboard-2026-11-01/google-question-draft.md` to Google Business Profile API Support. Targets ship without waiting (G6). If Google objects, set `STAFF_SCAN_TARGETS_ENABLED=false` and web restarts with targets off.
