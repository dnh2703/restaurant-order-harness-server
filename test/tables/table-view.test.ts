import { describe, expect, it } from 'bun:test'

import { toTableView } from '../../src/application/tables/table-view'

describe('toTableView', () => {
  it('maps a row to the admin-facing view', () => {
    const view = toTableView({
      id: 'table-1',
      name: 'Bàn 5',
      capacity: 4,
      qrToken: 'tok-abc',
      status: 'EMPTY',
    })
    expect(view).toEqual({
      id: 'table-1',
      name: 'Bàn 5',
      capacity: 4,
      qrToken: 'tok-abc',
      status: 'EMPTY',
    })
  })

  it('preserves a null capacity and an OCCUPIED status', () => {
    const view = toTableView({
      id: 'table-2',
      name: 'Bàn 6',
      capacity: null,
      qrToken: 'tok-def',
      status: 'OCCUPIED',
    })
    expect(view.capacity).toBeNull()
    expect(view.status).toBe('OCCUPIED')
  })
})
