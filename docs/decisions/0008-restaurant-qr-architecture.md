# 0008 Restaurant QR Ordering Architecture & Product Contract

Date: 2026-06-27

## Status

Accepted

## Context

`SPEC.md` provided the first real product for this harness: a single-restaurant QR
ordering system. Decomposing it crosses several hard gates — in-house auth, RBAC,
money/payment, and the full data model — so the stack and decomposition need a durable
record rather than living only in chat.

The spec proposes a stack (Elysia/Bun, Neon Postgres, in-house JWT, SSE realtime) but
leaves the ORM and build order open, and bundles every epic into one document.

## Decision

1. **Lock the stack** for the first buildout:
   - Backend: Elysia (Bun) in Clean Architecture (domain / application / infrastructure
     / presentation).
   - Database: Neon serverless Postgres via **Drizzle ORM** (SQL-first, light, strong
     Neon support, `drizzle-zod` for request validation).
   - Auth: in-house JWT access token (~15 min) + DB-stored, hashed, revocable refresh
     token; RBAC by `role`; tenant scope by `restaurantId`; customer scope by
     `qr_token`.
   - Realtime: SSE from Elysia backed by a single backend-held Postgres `LISTEN`
     connection (`RealtimeBroker`); clients never `LISTEN` directly; polling fallback.
2. **Decompose into product docs** under `docs/product/` (one per domain) as the living
   contract; treat `SPEC.md` as a historical seed (per decision 0002/0003).
3. **First slice = the customer ordering loop** (E01 foundation → E02 QR session → E03
   menu read → E04 ordering → E05 realtime). Staff/admin epics (auth, kitchen, cashier,
   admin CRUD, reports) are named candidates and depend on **E06 Auth & RBAC**.
4. **Enforce key invariants at the database** — notably one `OPEN` order per table via a
   partial unique index — not only in application code.
5. **Money is integer VND** everywhere; order totals are server-recomputed and
   snapshotted on `order_items` so menu edits never rewrite historical bills.

## Alternatives Considered

1. Prisma instead of Drizzle — heavier runtime and less SQL-transparent; rejected.
2. Supabase-style client realtime / client `LISTEN` — Neon has no built-in realtime and
   scale-to-zero punishes many idle client connections; rejected for a backend broker.
3. Building staff features first — rejected; the customer loop is the core value and can
   ship before staff auth, which becomes the next slice.
4. Keeping one monolithic spec as the plan — rejected per decisions 0002/0003.

## Consequences

Positive:

- Clear, bounded first slice that proves the end-to-end customer loop.
- Hard-gate areas (auth, payment, data) have explicit high-risk handling and docs.
- Database-level invariants prevent double-open-order races.
- Stack choices are recorded once and inherited by every story.

Tradeoffs:

- Staff-facing value (kitchen/cashier/admin) waits for the auth slice.
- Drizzle + Neon branching adds migration discipline that must be wired into the
  validation ladder.
- Surcharge modeling and refresh-token rotation are deferred open decisions.

## Follow-Up

- Slice E06 Auth & RBAC next; it unblocks E07–E10.
- Decide refresh-token rotation policy and surcharge modeling when E08 is sliced.
- Add `validate:quick` / `test:integration` ladder rungs once the toolchain exists and
  set story `--verify` commands.
