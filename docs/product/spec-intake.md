# Spec Intake — Restaurant QR Ordering

Date: 2026-06-27

## Source

- User prompt: "biến SPEC.md thành product docs và stories".
- Attached file: `SPEC.md` (Restaurant QR Ordering System).
- Intake record: `harness-cli` intake #1 (type "New spec", lane high-risk).

## Project Summary

A web app for one restaurant. Guests scan a per-table QR to browse the menu and order;
the kitchen updates dish statuses; the cashier bills and closes the table; the admin
manages menu/tables/reports. Stack and rationale: see
[`overview.md`](overview.md) and `docs/decisions/0008-restaurant-qr-architecture.md`.

## Product Docs Created

| File | Purpose | Source sections |
| --- | --- | --- |
| `overview.md` | product, actors, stack, build order | §1 |
| `data-model.md` | schema, invariants, indexes | §3 |
| `api-conventions.md` | REST naming, envelope, money, status codes | cross-cutting |
| `auth-authorization.md` | JWT, refresh, RBAC | EPIC 8 |
| `tables-qr.md` | table CRUD, QR token, session resolve | EPIC 1, US-6.4 |
| `menu.md` | browse, search, options, admin CRUD | EPIC 2, US-6.1–6.3 |
| `ordering.md` | cart, submit, status, service requests | EPIC 3 |
| `kitchen.md` | queue, status transitions, sold-out | EPIC 4 |
| `cashier-payment.md` | bill, discount, checkout, payment | EPIC 5 |
| `realtime.md` | SSE + LISTEN/NOTIFY broker | EPIC 9 |
| `reports.md` | revenue, top dishes | EPIC 7 |

## Epics

Customer-loop epics (E01–E05) are sliced for the first buildout. Staff/admin epics
(E06–E10) are named but not yet sliced — they enter as spec slices later.

| Epic | Description | SPEC source | Status | Risk |
| --- | --- | --- | --- | --- |
| E01 Foundation | scaffold + data model/migrations | stack, §3 | sliced | high-risk (data) |
| E02 QR session | QR → resolve table → open order | EPIC 1 | sliced | normal |
| E03 Menu (read) | browse/search/options for customer | EPIC 2 | sliced | normal |
| E04 Ordering | cart, submit, status, service requests | EPIC 3 | sliced | normal |
| E05 Realtime | SSE customer + restaurant streams | EPIC 9 | sliced | normal |
| E06 Auth & RBAC | staff login/refresh/logout + guard | EPIC 8 | candidate | high-risk (auth) |
| E07 Kitchen | queue + status + sold-out | EPIC 4 | candidate | normal |
| E08 Cashier & payment | bill, discount, checkout | EPIC 5 | candidate | high-risk (money) |
| E09 Admin menu/table CRUD | categories/dishes/options/tables | EPIC 6 | candidate | normal |
| E10 Reports | revenue, top dishes | EPIC 7 | candidate | normal |

> Dependency: E07–E10 require **E06 Auth & RBAC** (staff screens are guarded).

## First Story Packets (sliced)

| Story | Title | Lane | SPEC US |
| --- | --- | --- | --- |
| US-001 | Project scaffold + Neon connection + health | tiny | stack |
| US-002 | Data model + Drizzle migrations | high-risk | §3 |
| US-005 | QR resolve table + open order session | normal | US-1.1, 1.2 |
| US-006 | Menu browse by category | normal | US-2.1 |
| US-007 | Add items + submit order | normal | US-3.1, 3.2 |
| US-008 | Realtime customer order stream | normal | US-9.2 |

Story files live under `docs/stories/epics/`. Durable rows registered via
`harness-cli story add`; proof status starts at 0 (nothing implemented yet).

## Candidate Stories (not yet sliced)

- E06: US-8.1 login, US-8.2 refresh, US-8.3 logout, US-8.4 staff/role admin.
- E07: US-4.1 queue, US-4.2 status transition, US-4.3 sold-out toggle.
- E08: US-5.1 open tables, US-5.2 bill detail, US-5.3 discount, US-5.4 checkout.
- E09: US-6.1 categories, US-6.2 dishes, US-6.3 option groups, US-6.4 tables, US-1.3 QR export.
- E10: US-7.1 revenue, US-7.2 top dishes.

## Architecture Questions

- Runtime stack: Elysia (Bun), Clean Architecture layers.
- Product surfaces: customer web (no auth), staff web (kitchen/cashier/admin).
- Storage: Neon serverless Postgres via Drizzle ORM.
- External providers: none for MVP (payment is recorded, not charged).
- Deployment target: TBD (Bun server; Neon Functions is an option for the SSE server).
- Security model: in-house JWT + DB refresh tokens; RBAC by role; tenant scope by
  `restaurantId`; customer scope by `qr_token`.

## Validation Shape

| Layer | Expected proof |
| --- | --- |
| Unit | price/total math, status-transition matrix, token hashing, broker fan-out |
| Integration | DB-backed flows: open order, submit append, checkout atomicity, NOTIFY→SSE |
| E2E | customer scan→order→status; staff login→guarded screen; cashier checkout |
| Platform | SSE under Neon scale-to-zero; polling fallback |
| Release | full suite + seed + smoke |

## Open Decisions

- Refresh-token rotation on every refresh vs. fixed lifetime (deferred).
- Surcharge modeling: signed `discount_amount` vs. separate line (MVP: discount only).
- Deployment shape for the SSE listener under Neon scale-to-zero.
- ORM confirmed as Drizzle (recorded in decision 0008).

## Harness Delta

- Created 11 product docs + this intake under `docs/product/`.
- Registered 6 first-slice stories in the durable layer + test matrix.
- Recorded decision `0008-restaurant-qr-architecture.md`.
- No harness friction blocking; CLI and templates were sufficient.
