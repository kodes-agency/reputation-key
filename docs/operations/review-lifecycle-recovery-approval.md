# Review lifecycle recovery confirmation

Run the restore verifier only against an isolated restored database. It accepts
an attested loopback tunnel or the exact Railway PITR sibling private hostname
in `closed-beta-v2`. `RESTORE_MODE=isolated` is required. Unset every Redis,
queue and bucket setting: inherited values refuse before runtime boot, even if
they point to loopback. The worker must remain stopped.

First inspect the aggregate report:

```sh
pnpm ops restore-verify --operator <id>
```

Apply by typing the exact environment name:

```sh
pnpm ops restore-verify --operator <id> --reason <change-ref> --apply --yes closed-beta-v2
```

Missing or incorrect confirmation refuses before runtime boot or mutation.
The command logs the confirmed environment, named operator, time and
correlation ID before reserving or resuming recovery work. No signed Review
approval bundle or trusted keyring is required.

The Review receipt still binds the source release, manifest, restore point,
sibling, policy, frozen report, recovery UUID and generation. Its existing
approval-named columns hold the confirmation's operator, time and digest.
They remain storage compatibility fields, not a request to sign anything.
Review pages advance their durable checkpoint atomically with mutation. A
retry loads that binding rather than reporting already changed rows again;
changed targets or policies refuse. Completed Review pages are not applied
twice against their frozen cutoff. Once that pass finishes, the command sweeps
expiry from the start at a fresh cutoff, including Reviews that expired behind
the saved cursor during an interruption. These additional atomic pages safely
replay after interruption without rewriting the original receipt's evidence.
Expiry is checked again after the fence; any remaining content leaves the
receipt unfinished for another retry. Fence execution retains the receipt's original operator and correlation
ID across invocations; the confirmation log records the current confirmer
separately. Only the exact recovery run and generation can complete the receipt.

The command also reconciles Google import lifecycle and retention, then
applies the recovery fence and checks that every bounded backlog and restored
authority count is zero. Preserve its printed recovery run and generation for
cutover. Follow [backup and lifecycle](backup-and-lifecycle.md)
for the remaining checks and serving procedure.

Erasure replay is **not wired**. This command does not re-apply or verify
post-restore-point erasures. Reconcile those before cutover; a successful data
restore rehearsal alone does not prove erasure replay.
