# Decisions

Decision records explain why important product, architecture, or harness choices
were made.

Use `docs/templates/decision.md` when adding a new decision.

After adding or updating a markdown decision file, also add or refresh the
durable decision row:

```bash
scripts/bin/harness-cli decision add \
  --id 0008-auth-boundary \
  --title "Auth Boundary" \
  --doc docs/decisions/0008-auth-boundary.md
```

Trace fields such as `--decisions` summarize task-level choices. They do not
count as the Harness decision log.

Add a decision when:

- A locked technical choice changes.
- A product rule changes meaningfully.
- A validation requirement is added, removed, or weakened.
- A high-risk feature chooses one design over another.
- Auth, authorization, data ownership, audit/security, or API behavior changes.
- The source-of-truth hierarchy changes.

## Index

- [0001 Harness-First Development](0001-harness-first-development.md)
- [0002 Seed Specification Product Lifecycle](0002-post-spec-product-lifecycle.md)
- [0003 Generic Spec Intake Harness](0003-generic-spec-intake-harness.md)
- [0004 SQLite Durable Layer](0004-sqlite-durable-layer.md)
- [0005 Prebuilt Rust Harness CLI](0005-prebuilt-rust-harness-cli.md)
- [0006 Phase 4 Benchmark Triage](0006-phase-4-benchmark-triage.md)
- [0007 Improvement Proposal Rules](0007-improvement-proposal-rules.md)
- [0008 Restaurant QR Ordering Architecture & Product Contract](0008-restaurant-qr-architecture.md)
- [0009 CI Pipeline & API Documentation](0009-ci-and-api-docs.md)
- [0010 Refresh Token Rotation & Reuse Detection](0010-refresh-token-rotation.md)
