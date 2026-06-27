# Product Overview — Restaurant QR Ordering

## What We Are Building

A web app for a single restaurant where a guest scans the QR code on their table,
browses the menu, and orders dishes. The kitchen receives dishes and updates their
status, the cashier finalizes the bill and payment, and the admin manages the menu,
tables, and reports.

The app is what users touch. The harness is what agents touch. This document is the
product contract for the app; derive behavior changes by updating the domain docs in
this folder, not by re-editing `SPEC.md`.

## Actors

| Actor | Auth | Primary surface |
| --- | --- | --- |
| Customer (guest) | None — enters via table QR token | Customer menu / cart / status |
| Kitchen (cook) | Staff login, role `KITCHEN` | Kitchen board |
| Cashier | Staff login, role `CASHIER` | Cashier / billing |
| Admin (owner) | Staff login, role `ADMIN` | Admin menu / tables / reports |

## Product Domains

Each domain has its own contract doc in this folder:

| Domain | Doc | Source epics |
| --- | --- | --- |
| Data model & conventions | [`data-model.md`](data-model.md) | DB schema |
| API conventions | [`api-conventions.md`](api-conventions.md) | cross-cutting |
| Auth & authorization | [`auth-authorization.md`](auth-authorization.md) | EPIC 8 |
| Tables & QR sessions | [`tables-qr.md`](tables-qr.md) | EPIC 1, US-6.4 |
| Menu | [`menu.md`](menu.md) | EPIC 2, US-6.1–6.3 |
| Ordering | [`ordering.md`](ordering.md) | EPIC 3 |
| Kitchen | [`kitchen.md`](kitchen.md) | EPIC 4 |
| Cashier & payment | [`cashier-payment.md`](cashier-payment.md) | EPIC 5 |
| Realtime | [`realtime.md`](realtime.md) | EPIC 9 |
| Reports | [`reports.md`](reports.md) | EPIC 7 |

## Stack (locked)

- Backend: Elysia (Bun), Clean Architecture (Domain / Application / Infrastructure /
  Presentation).
- Frontend: TanStack Start, Feature-Sliced Design, Tailwind CSS.
- Database: Neon (serverless Postgres, branching + scale-to-zero), Drizzle ORM.
- Auth: in-house JWT access token (~15 min) + DB-stored revocable refresh token.
- Realtime: SSE from Elysia, sourced from Postgres `LISTEN/NOTIFY`; MVP fallback is
  polling every 2–3s.

Architectural rationale and risk gates are recorded in
`docs/decisions/0008-restaurant-qr-architecture.md`.

## Core Loop (MVP happy path)

```text
scan QR -> resolve table -> open/get OPEN order
  -> browse menu -> add to cart -> submit order (PENDING items)
  -> kitchen cooks (PENDING -> COOKING -> SERVED)
  -> customer sees status update in realtime
  -> request bill -> cashier checks out -> order PAID, table EMPTY
```

## First-Slice Build Order

The first vertical slice proves the customer ordering loop end to end. Staff-facing
domains depend on auth and are sliced after the foundation is stable.

| Order | Epic | Stories | Status |
| --- | --- | --- | --- |
| 1 | E01 Foundation | US-001 scaffold, US-002 data model | sliced |
| 2 | E02 QR session | US-005 QR → open order | sliced |
| 3 | E03 Menu (customer read) | US-006 menu browse | sliced |
| 4 | E04 Ordering | US-007 add + submit order | sliced |
| 5 | E05 Realtime | US-008 customer order stream | sliced |
| 6 | E06 Auth & RBAC | — | candidate (blocks all staff screens) |
| 7 | E07 Kitchen | — | candidate |
| 8 | E08 Cashier & payment | — | candidate |
| 9 | E09 Admin menu/table CRUD | — | candidate |
| 10 | E10 Reports | — | candidate |

Full decomposition of every user story lives in
[`spec-intake.md`](spec-intake.md).

## Out of Scope (MVP)

- Multi-restaurant tenancy beyond the `restaurant_id` column already in the schema.
- Customer accounts / loyalty.
- Online prepayment / payment gateway integration (payment is recorded, not charged).
- Inventory management.
