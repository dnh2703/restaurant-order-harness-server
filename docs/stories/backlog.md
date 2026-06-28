# Story Backlog

This backlog will be populated after a user provides a project spec or selects a
specific initiative.

Do not create every possible story packet up front. Create story packets when
the work is selected or when a product decision needs a durable place to land.

Populated from `SPEC.md` via intake #1. Full decomposition:
`docs/product/spec-intake.md`. Architecture: `docs/decisions/0008-restaurant-qr-architecture.md`.

## Sliced Epics (first buildout — customer ordering loop)

| Epic | Stories | Status |
| --- | --- | --- |
| E01 Foundation | US-001 scaffold, US-002 data model | sliced |
| E02 QR session | US-005 QR → open order | sliced |
| E03 Menu (read) | US-006 menu browse | sliced |
| E04 Ordering | US-007 add + submit order | sliced |
| E05 Realtime | US-008 customer order stream | sliced |
| E06 Auth & RBAC | US-009 auth + guard, US-010 staff admin | sliced |
| E07 Kitchen | US-011 queue + status, US-012 sold-out, US-013 staff stream | sliced |

Story files: `docs/stories/epics/`. Durable rows: `harness-cli query matrix`.

## Candidate Epics (not yet sliced)

> E08–E10 depend on **E06 Auth & RBAC** (now sliced; all staff screens are role-guarded).

| Epic | Candidate stories | SPEC | Risk | Status |
| --- | --- | --- | --- | --- |
| E08 Cashier & payment | open tables, bill detail, discount, checkout | EPIC 5 | high-risk (money) | unsliced |
| E09 Admin menu/table CRUD | categories, dishes, options, tables, QR export | EPIC 6 + US-1.3 | normal | unsliced |
| E10 Reports | revenue by range, top dishes | EPIC 7 | normal | unsliced |

## Deferred Customer Stories (within sliced epics)

- US-2.2 menu search (diacritic-insensitive) — E03 follow-up.
- US-2.3 dish detail + option selection UI — E03 follow-up.
- US-3.3 live status view (customer) — covered by US-008 stream consumer.
- US-3.4 call staff / request bill — E04 follow-up.
- US-9.1 staff restaurant-wide SSE stream — sliced as E07/US-013 on the US-008 broker.
