# Operations

Start with the symptom and follow the numbered section in
[runbooks.md](runbooks.md). The [alert guide](alerts-and-security-posture.md)
maps registered signals to those sections. A registered but unimplemented signal
is not monitoring coverage.

| Symptom or task                                          | Procedure                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| Outside customer, hire or Google production submission   | [Launch verification](obligation-checks.md#launch-blockers) |
| Unavailable site, failed release, saturated database     | Runbooks §§8, 12, 28                                        |
| Worker, queue or Redis not progressing                   | Runbooks §§7, 14, 17, 23                                    |
| Google authorization, import or sync failing             | Runbooks §§2–5, 13, 25                                      |
| Reply outcome uncertain or duplicate suspected           | Runbooks §6; read back before another write                 |
| Notification or mandatory email stalled                  | Runbooks §§15, 24                                           |
| Suspected secret leak, tenant breach or privacy incident | Runbooks §§1, 9, 11, 19, 21                                 |
| Portal address or image problem                          | Runbooks §§20, 26, 27, 31                                   |
| AI coverage, authorization or renewal stalled            | Runbooks §§22, 32–34                                        |

For a first check and action by area (site and release, restore, Google, queue and
Redis, security and privacy) use the [triage trees](triage.md).

[Operator commands](operator-commands.md) documents the supported command
surface. [Backup and lifecycle](backup-and-lifecycle.md) records backup state,
retention and restore restrictions. [Organization lifecycle](organization-lifecycle.md)
distinguishes implemented mechanisms from quarantined workflows. Never infer
that an export or purge is available from a retained module or table.

For each release, use the checklist in [obligations](../obligations.md), including
green CI for the exact image, migration parity, readiness, one authenticated
journey, a recent verified backup and a named 24-hour watch. Deploy through the
supported image promotion command. Repair a bad release forward; preserve every
applied migration. Point-in-time restore is for data loss.

The [obligation verification procedures](obligation-checks.md) cover live checks,
provider commitments and promises without automated proof. The data restore on
2026-11-04 succeeded; it did not prove full operational recovery or erasure
replay. Do not repeat it merely to replace evidence that already exists.

[Incident lessons](../lessons.md) explain the constraints behind these procedures.
