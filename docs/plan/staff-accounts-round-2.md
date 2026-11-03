# Staff accounts, round 2

Owner decisions of 2026-11-03. The binding detail is the round-2 brief and
[ADR 0076](../adr/0076-staff-accounts-and-personal-portals.md).

| Decision            | Result                                                                                                                       | Pull request       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| R1, F1, F2          | Guest wording checked before creation; admins can save it in Add; readable failures and resumable setup                      | PR 1, manager      |
| R5                  | Copies inherit eligible responsible managers; eligible creator is the fallback                                               | PR 1               |
| R6                  | Managers alone see No scans lately after 14 Property days for joined staff; Privacy Notice 3.4 and Agreement 2.5 disclose it | PR 1               |
| R7                  | Personal print filenames and available margins name the person; cut pieces keep the guest wording                            | PR 1               |
| R8                  | Copies keep safe opening print wording in the Portal transaction; Share explains that the phone uses it                      | PR 1, Share half   |
| R8                  | The code tile reads the resolved opening wording                                                                             | PR 2, phone half   |
| R10                 | An unambiguous published source is selected; otherwise the manager chooses; people come first and paste is visible           | PR 1               |
| R11                 | One Staff list and Add staff; profiles without login leave the product; retained tables still support attribution            | PR 1               |
| R12                 | Email-only joining; expired invitations show Resend                                                                          | PR 1               |
| R17                 | Staff and Portals open the same responsive person sheet                                                                      | PR 1               |
| R18                 | Resend and group moves run sequentially, reporting individual refusals; removal stays individual                             | PR 1               |
| R20                 | A pending or expired invitation can change address; acceptance/linking ends that option; code stays the same                 | PR 1               |
| Manager fixes       | Send failures are visible; limits name the actual invitation budgets; one-item group actions are direct buttons              | PR 1               |
| R2–R4, R9, R16, R21 | Home-screen step, icons, Last month, retained code during refresh, the Pass, check-in results, phone fixes                   | PR 2               |
| R19                 | Batch replacement of guest pages                                                                                             | Later PR 3         |
| R13–R14             | Removal remains final; review-name mentions wait                                                                             | No additional work |

The capability and manager/staff resolver boundary are unchanged. Nobody is
ranked, guests see no person's name, and no beta data is deleted by these PRs.
After deployment the owner tests a staff-only login and guest scan on a real
phone. Demo cleanup names the exact rows before deletion; What's new follows
that trial.
