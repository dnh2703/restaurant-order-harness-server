/**
 * Admin-facing shape of a table (US-017). `qrToken` is exposed so the admin can build/print the QR;
 * `status` is read-only here (system-managed by the session lifecycle, US-005). `capacity` is a
 * nullable integer.
 */
export interface TableView {
  id: string
  name: string
  capacity: number | null
  qrToken: string
  status: 'EMPTY' | 'OCCUPIED'
}

export function toTableView(row: {
  id: string
  name: string
  capacity: number | null
  qrToken: string
  status: 'EMPTY' | 'OCCUPIED'
}): TableView {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    qrToken: row.qrToken,
    status: row.status,
  }
}
