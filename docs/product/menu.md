# Menu

Covers EPIC 2 (customer browsing) and US-6.1–6.3 (admin menu administration).

## Customer Browsing (EPIC 2)

### View by category (US-2.1)
- Menu is grouped by `category`, ordered by `sort_order`.
- Each dish shows name, image, price (VND), description.
- `is_available = false` dishes are shown dimmed with a "Sold out" label (not hidden,
  so guests understand the full menu) — except items hidden by kitchen sold-out, see
  `kitchen.md`.

### Search & filter (US-2.2)
- Search by name, **diacritic-insensitive** (e.g. "pho" matches "phở"). Use Postgres
  `unaccent` + `ILIKE` or a normalized search column.
- Filter by category.

### Dish detail & options (US-2.3)
- Show option groups:
  - `SINGLE` (required radio) and `MULTI` (checkbox).
  - `is_required` groups must have a selection before adding to cart.
- Free-text note per dish.
- Live price = `menu_items.price + Σ(selected option.price_delta)`.

## Admin Administration (Admin)

### Categories (US-6.1)
- CRUD categories with `name` and `sort_order`.

### Dishes (US-6.2)
- CRUD `menu_items`: name, price, image, description, category, `is_available`.

### Option groups & options (US-6.3)
- CRUD `option_groups` (type SINGLE/MULTI, `is_required`) and their `options`
  (`name`, `price_delta`) per dish.

## Availability

- `is_available` is the single availability flag. Admin sets it for long-term
  changes; Kitchen toggles it for temporary sold-out (see `kitchen.md` US-4.3).
- Toggling availability pushes a realtime menu update to customers.

## Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/api/qr/:qrToken/menu` | none | full menu grouped by category, with options |
| GET | `/api/qr/:qrToken/menu/search?q=&categoryId=` | none | diacritic-insensitive search |
| GET/POST/PATCH/DELETE | `/api/categories[...]` | ADMIN | category CRUD |
| GET/POST/PATCH/DELETE | `/api/menu-items[...]` | ADMIN | dish CRUD |
| POST/PATCH/DELETE | `/api/menu-items/:id/option-groups[...]` | ADMIN | options CRUD |

## Validation Shape

| Layer | Proof |
| --- | --- |
| Unit | option price math, required-group validation, diacritic normalization |
| Integration | menu read returns grouped + options; admin CRUD persists; sold-out reflects in customer read |
| E2E | customer browses, searches "pho", opens dish, selects required option, price updates |
