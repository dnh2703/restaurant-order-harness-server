# Overview

US-021 — Dish image upload (Cloudflare R2)

## Current Behavior

Admin sets a dish image only by pasting an external URL into the `imageUrl`
field of `POST /api/menu-items` or `PATCH /api/menu-items/:id` (US-015). There is
no way to upload an image file from the admin's machine; `menu_items.image_url`
just stores whatever string is sent. No object storage is wired into the app.

## Target Behavior

Admin uploads a dish image file directly. A new ADMIN-only, tenant-scoped
endpoint `POST /api/menu-items/image` accepts a `multipart/form-data` file,
validates its type and size, streams it to a Cloudflare R2 (S3-compatible)
public-read bucket under a tenant-scoped key, and returns the public URL. The
admin then saves that URL as `imageUrl` on create/update. Pasting an external
URL still works unchanged (backward compatible).

## Affected Users

- ADMIN (only role that manages the menu).

## Affected Product Docs

- `docs/product/menu.md` (US-6.2 dish administration — image source).
- `docs/product/api-conventions.md` (new multipart endpoint + error codes).

## Non-Goals

- Orphaned-object cleanup when an image is replaced or a dish is deleted
  (deferred; tracked in the harness backlog).
- Image resizing, thumbnails, format conversion, or CDN cache tuning.
- Private buckets / signed reads — menu photos are public by nature.
- Changing the `imageUrl` contract on create/update (still accepts any string).
- Admin frontend UI (this story is the server contract only).
