# US-026 Reject non-URL `imageUrl` values on menu-item create/update

## Status

planned

## Lane

normal

## Product Contract

`imageUrl` on `POST /api/menu-items` and `PATCH /api/menu-items/:id` accepts only `null` or
an absolute `http(s)://` URL. Any other string is rejected with the existing
`VALIDATION_ERROR` envelope instead of being stored verbatim.

## Relevant Product Docs

- `docs/product/menu.md`
- `docs/product/api-conventions.md`

## Acceptance Criteria

- `POST /api/menu-items` and `PATCH /api/menu-items/:id` reject an `imageUrl` that is neither
  `null`/absent nor a well-formed absolute `http://`/`https://` URL, returning
  `422 VALIDATION_ERROR` (matching the existing envelope other field validations already use).
- `POST /api/menu-items/:id/image` (US-021 upload endpoint) is unaffected — it writes the R2
  public URL server-side and never takes `imageUrl` from client input.
- Existing valid `imageUrl` values already stored (R2 URLs from US-021) continue to read back
  and serve unchanged.
- No regression: full suite green.

## Design Notes

- Commands: `create-menu-item`, `update-menu-item` — no application-layer change; validation
  moves to the Elysia route schema, which is the existing pattern for this codebase's other
  format constraints (e.g. `t.String({ format: 'uuid' })`).
- Queries: none.
- API: `src/presentation/http/routes/menu-items.ts` — tighten
  `imageUrl: t.Union([t.String(), t.Null()])` (create/update bodies, lines ~18/30/41) to a
  URL-shaped constraint, e.g. `t.Union([t.String({ format: 'uri', pattern: '^https?://' }), t.Null()])`.
- Tables: none.
- Domain rules: `imageUrl`, when present, must be an absolute `http(s)://` URL.
- UI surfaces: Admin menu-item form — must already produce well-formed URLs (from the image
  upload flow); no UI change expected.

## Validation

`scripts/bin/harness-cli story update --id US-026 --unit 1 --integration 1 --e2e 0 --platform 0`

| Layer | Expected proof |
| --- | --- |
| Unit | schema rejects non-URL strings (`"not a url"`, `"javascript:alert(1)"`, `"ftp://x"`), rejects nothing for `null`/absent, accepts a well-formed `https://` URL |
| Integration | `POST`/`PATCH /api/menu-items` with a malformed `imageUrl` → 422; with a valid URL or `null` → 200/201 unchanged |
| E2E | |
| Platform | |
| Release | |

## Harness Delta

No new decision — single schema-level validation tightening, not a hard gate (see decision
0025's follow-up).

## Evidence

Add after implementation.
