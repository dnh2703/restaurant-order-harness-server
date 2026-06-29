# Validation — US-018 Cashier & Payment

## Proof Strategy

A high-risk (money) story: the proof must demonstrate the money-safety invariants, not just the
happy path. Specifically — no double-charge under a concurrent second checkout, server-authoritative
payment amount, integer-floored discount math, tenant isolation, and the OPEN-only guard on discount
and checkout. Pure money math is unit-tested; the DB-backed invariants are proven through HTTP
integration tests against a live migrated Neon branch (the suite self-skips when the DB is
unreachable, so a green run only counts when executed against the real DB).

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | `resolveDiscountAmount`: PERCENT = round(subtotal×value/100) incl. a rounding case (33333→3333); FIXED = value; value>100 → INVALID_DISCOUNT; negative → INVALID_DISCOUNT (defense-in-depth). |
| Integration | List shows only this tenant's open orders with correct total + itemCount; bill detail 200, cross-tenant → 404 ORDER_NOT_FOUND; discount PERCENT recomputes total, on non-OPEN → 409 ORDER_NOT_OPEN, value>100 → 422 INVALID_DISCOUNT; **checkout happy → order PAID + payment.amount = total + table EMPTY + exactly one payment row**; **double checkout → 200 then 409 ORDER_NOT_OPEN with still exactly one payment**; cross-tenant checkout → 404; RBAC 401 (no token). |
| E2E | Deferred — covered indirectly: an order opened via US-007 appears in `/cashier/tables`, is discounted, and is closed by payment; the freed table re-opens a fresh order on the next QR scan (US-005). |
| Platform | n/a (backend only). |
| Performance | n/a (single-row reads/writes; list is one join + correlated count). |
| Logs/Audit | Each close-out writes a `payments` row (`cashier_id`, `amount`, `paid_at`) — the durable audit. Accepted gap: a crash between gate and payment insert leaves a PAID order without a payment row (lost audit, never a double charge). |

## Fixtures

- Two restaurants A and B; users: cashier-A (`CASHIER`), admin-A (`ADMIN`), cashier-B (`CASHIER`).
- `seedOpenOrder` helper seeds a real `categories` + `menu_items` row (FK-valid) and one OPEN order
  with a priced `order_item` for restaurant A.
- Teardown deletes `payments` (subselect on tenant order ids) before `orders`, then tables →
  menu_items → categories → users → restaurants (FK-safe).

## Commands

```text
bun test test/cashier/discount.test.ts
bun test test/cashier/cashier-routes.integration.test.ts
bun run typecheck && bun run lint && bun test
```

## Acceptance Evidence

- Unit: `discount.test.ts` 3/3 (RED→GREEN recorded).
- Integration: `cashier-routes.integration.test.ts` 9/9 (3 read + 3 discount + 3 checkout),
  executed against a live migrated Neon branch (DB ran).
- Full suite: **204 pass / 0 fail** across 43 files; `typecheck` clean; `lint` clean.
- Reviews: per-task gates all Approved (Task 3 reviewed on opus, zero issues); final whole-branch
  review (opus) **Ready to merge — Yes**, no Critical/Important.

### Deferred follow-ups (non-blocking, recorded for a later story)

- FIXED discount `value` has no `maximum` → a value above int4 range overflows the integer column
  → 500 instead of a typed 422. Quick hardening: bound the value on the wire schema or in
  `resolveDiscountAmount`.
- `applyDiscount` reads subtotal then writes in two statements; a concurrent `addOrderItems` can
  make a PERCENT discount transiently off (self-heals on next recompute).
- Coverage: add a non-cashier 403 test, a discount 404 test, and an explicit `discountAmount`
  assertion on the list; typed `INVALID_DISCOUNT` for negative values would require loosening the
  wire schema.
