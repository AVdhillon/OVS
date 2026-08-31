# Accepted Tradeoff: IP-Based Correlation Risk (vote_ballots ↔ user_sessions)

**Status:** Accepted
**Related:** `fraud-heuristic-implementation-plan.md` (Module B, E),
`ovs-review-findings-open.md` finding #2
**Owner:** update this doc if the mitigations below change; this is the
durable record — the findings file is not.

## The tradeoff

`vote_ballots` is structurally anonymous: it has no `orgid`/`uid` column
and no foreign key to `org_members` or `event_participants`, so no single
row in that table can ever pair an identity with a candidate choice (see
schema section "12. ANONYMOUS BALLOTS").

However, `vote_ballots.ip_address` and `user_sessions.ip_address` both
exist, independently, for legitimate reasons:

- `vote_ballots.ip_address` — signal for fraud/abuse detection (unusual
  concentration of ballots from one network).
- `user_sessions.ip_address` — standard session/security metadata (device
  changes, suspicious-login detection, incident response).

Anyone with read access to **both** tables can, in principle, narrow down
or in some cases fully identify which authenticated session cast a given
ballot, by correlating the IP (and timing) on a `vote_ballots` row against
the IP a specific `uid` was sessioned from around that time. This is a
**theoretical re-identification path that exists despite the anonymous
ballot design**, not a bug in that design — it's a consequence of storing
IPs on both sides at all.

**This is an accepted tradeoff.** The alternative — not collecting IPs on
ballots at all — removes the platform's only per-vote fraud signal
entirely. The mitigations below are what keep the tradeoff's residual risk
small, not a claim that the risk is zero.

## Mitigations in place today

1. **IP truncation at write time, on both sides of the correlation pair.**
   `cast_ballot()` truncates the caller's IP to subnet granularity before
   it is ever written to `vote_ballots` — `/24` for IPv4, `/64` for IPv6
   (`truncate_ip_to_subnet()`). A `trg_truncate_session_ip` trigger applies
   the same `truncate_ip_to_subnet()` to `user_sessions.ip_address` on
   insert. Full-precision IPs are never stored in either table, so
   correlating the two can at best narrow a ballot down to a subnet of
   addresses shared with a subnet of sessions — not a single IP on either
   side.

   `user_sessions.ip_address` was reassessed and truncated (not left at
   full precision as originally written in this doc) because, on
   inspection, nothing in the application actually reads it — no
   anomaly/geo detection, no admin session view, no audit trigger on that
   table. Full precision there was pure write-only telemetry, and it was
   the *stronger* half of the correlation risk once `vote_ballots` was
   truncated on its own. If session-based security features (e.g.
   new-location login alerts) are built later, they should work fine on
   subnet-level granularity; if one genuinely needs finer precision, that
   should be a deliberate, documented exception at the time, not a
   leftover default.

2. **The old flat fraud trigger is retired, not patched (Module B,
   shipped).** `detect_vote_fraud()` / `trg_detect_vote_fraud` (global
   `>4`/`>3` thresholds) has been dropped. **Note:** this means there is
   currently *no* automated fraud signal running against `vote_ballots` —
   Module C (self-baseline aggregation) and Module D (organizer dashboard)
   replace it, but are not yet implemented. Fraud investigation until then
   is manual/ad hoc against `vote_ballots.ip_address` /
   `device_fingerprint` directly. This gap is intentional and tracked
   separately; it does not change the correlation tradeoff documented
   here, since no un-truncated IP is involved either way.

## Mitigations still to land (tracked, not yet built)

These do not block accepting the tradeoff today, but reduce its residual
risk further once built:

- **Retention window.** Prune/roll up `vote_ballots.ip_address` /
  `device_fingerprint` history past a defined window (plan suggests
  6–12 months) so the correlation surface doesn't grow unbounded over the
  life of the platform. Currently `vote_ballots` rows are retained
  indefinitely.
- **Restricted read access to both tables.** DB-level access control
  (roles/grants) limiting who can query `vote_ballots.ip_address` *and*
  `user_sessions.ip_address` together is not yet formalized — today this
  is enforced only by "no application code path exposes both," not by a
  DB grant. This matters less now that both are subnet-truncated, but
  still isn't nothing: a `GRANT`/role-separation pass (e.g. no single
  application role needs read access to raw `ip_address` on both tables
  simultaneously) would close this at the DB layer instead of relying on
  application code staying correct.

## What would change this doc

- Landing the retention job or the read-access restriction above — move
  the relevant bullet up to "in place."
- Any change to what's stored in `user_sessions.ip_address` (e.g. if it
  were ever truncated too) — re-evaluate whether the residual correlation
  risk assessment above still holds.
- Landing Module C/D — update the fraud-signal-gap note above; it will no
  longer be accurate once a baseline-comparison signal exists again.
