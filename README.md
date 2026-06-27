# Restaurant QR Ordering — Server

A web app for a single restaurant where a guest scans the QR code on their
table, browses the menu, and orders dishes. The kitchen receives dishes and
updates their status, the cashier finalizes the bill and payment, and the admin
manages the menu, tables, and reports.

This repository is built on a **harness** operating model: agents read the
product contract, classify the work, and produce proof before changing code.
The app is what users touch; the harness is what agents touch.

## How This Repo Works

Before changing code, an agent answers practical questions from durable docs
rather than chat history: what to read first, what kind of work this is, which
product contract it affects, how risky it is, and what proof shows it is done.

Those answers live in:

- `AGENTS.md` — agent shim with local project notes and harness doc links.
- `docs/HARNESS.md` — the human-agent collaboration model.
- `docs/FEATURE_INTAKE.md` — tiny / normal / high-risk work classification.
- `docs/ARCHITECTURE.md` — architecture discovery and boundary rules.
- `docs/TEST_MATRIX.md` — behavior-to-proof validation expectations.
- `docs/stories/` — story packets and backlog.
- `docs/decisions/` — durable decisions and tradeoffs.
- `docs/templates/` — reusable spec, story, decision, and validation templates.

The durable layer (intake records, decisions, and the per-story test matrix) is
managed with the Rust Harness CLI at `scripts/bin/harness-cli`:

```bash
scripts/bin/harness-cli query matrix          # per-story proof status
scripts/bin/harness-cli query tools --status present
```

A typical flow: product spec → product contract → feature intake → story packet
→ validation expectations → implementation → decision captured for future work.

## Current State

The spec (`SPEC.md`) has been decomposed into product docs, story packets, and
an architecture decision. The first buildout — the customer ordering loop plus
auth — is sliced as epics **E01–E06**. Implemented so far:

- **US-001 — Project scaffold + Neon connection + health.** Elysia (Bun) backend
  in Clean Architecture layout, Drizzle + `node-postgres` connected to Neon, and
  `GET /api/health`. Verified against a live Neon branch.
- **Shared error catalog** (`src/shared/errors`) — one source of truth for error
  codes, messages, and HTTP statuses, surfaced through the standard envelope.

Remaining first-slice stories (US-002 data model, US-005–US-008 customer loop,
US-009/US-010 auth & RBAC) are sliced and tracked in the test matrix with proof
status starting at 0.

## Running The App

Requires Bun ≥ 1.3 and a Neon (or any Postgres) `DATABASE_URL`.

```bash
bun install
cp .env.example .env          # then set DATABASE_URL (use sslmode=verify-full)
bun run dev                   # watch mode; GET /api/health -> { data: { status: "ok" } }
```

Common scripts:

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # oxlint src test
bun run format      # prettier --write
bun test            # bun test
bun run db:generate # drizzle-kit generate (migrations land from US-002)
bun run db:migrate  # apply migrations
```

Git hooks (Husky) run on commit: `pre-commit` formats/lints staged files via
lint-staged, and `commit-msg` enforces Conventional Commits via commitlint.

### Stack

- **Backend:** Elysia (Bun), Clean Architecture (`domain` / `application` /
  `infrastructure` / `presentation`, plus a `shared` kernel).
- **Database:** Neon serverless Postgres via Drizzle ORM on the `node-postgres`
  driver (chosen so the realtime broker can hold a persistent `LISTEN/NOTIFY`
  connection).
- **Auth (planned):** in-house JWT access token + DB-stored revocable refresh
  token.
- **Realtime (planned):** SSE from Elysia sourced from Postgres `LISTEN/NOTIFY`.

Rationale and risk gates: `docs/decisions/0008-restaurant-qr-architecture.md`.

## Product Sources

The product contract is derived from `SPEC.md` and lives as smaller living
artifacts:

- `SPEC.md`: the seed input spec for the first buildout.
- `docs/product/`: product contract files (overview, data model, API
  conventions, auth, and per-domain docs).
- `docs/stories/`: story packets (`epics/`) and the backlog.
- `docs/TEST_MATRIX.md`: behavior-to-proof control panel.
- `docs/decisions/`: durable decisions and tradeoffs.

## Repository Structure

```text
project/
  AGENTS.md
  README.md
  SPEC.md                  # seed product spec (Restaurant QR Ordering)
  package.json             # Bun app: scripts, deps, tooling
  drizzle.config.ts        # Drizzle Kit config (Neon Postgres)
  src/                     # application code (Clean Architecture)
    domain/                # entities, value objects, domain rules
    application/           # use cases
    infrastructure/        # config, Drizzle/pg client, db health
    presentation/http/     # Elysia app, routes, plugins
    shared/errors/         # error catalog + AppError + envelope
  test/                    # bun tests
  docs/
    HARNESS.md
    FEATURE_INTAKE.md
    ARCHITECTURE.md
    TEST_MATRIX.md
    product/               # product contract derived from SPEC.md
    stories/               # story packets and backlog
    decisions/             # durable decisions and tradeoffs
    templates/
  scripts/
    bin/harness-cli        # Rust Harness CLI (durable layer)
```
