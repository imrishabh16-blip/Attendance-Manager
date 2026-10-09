// Characterization tests for deriveClientWorkDuration (Client Analytics).
// These pin the semantics of the slot calculation so later changes can't
// silently alter them:
//   Days = distinct attendance dates on which the client had >= 1 punch,
//          combining all articles (NOT man-days)
// Hours is no longer part of Client Analytics: a slot carries no duration
// field at all (asserted below). Session closing and any article-level days
// are separate, pending work and deliberately NOT pinned here.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveClientWorkDuration, type RawSessionRecord } from '../src/lib/workDuration.ts'

const TODAY = '2026-10-08'

// One closed session, as the attendance query returns it. The times only make
// the record realistic — Client Analytics does not use durations.
function session(article: string, client: string, date: string, from: string, to: string): RawSessionRecord {
  return {
    article_id:      article,
    article_name:    `Article ${article}`,
    client_name:     client,
    attendance_date: date,
    checked_in_at:   `${date}T${from}:00+00:00`,
    checked_out_at:  `${date}T${to}:00+00:00`,
  }
}

describe('deriveClientWorkDuration', () => {
  it('Days counts a date once however many articles punched it (client days, not man-days)', () => {
    const rows = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '13:00'),
      session('B', 'Acme', '2026-09-01', '10:00', '14:00'),   // second article, same date
    ], TODAY)

    assert.equal(rows.length, 1)
    assert.equal(rows[0].attendance_days, 1)        // not 2 (man-days)
    assert.equal(rows[0].articles_count, 2)
    assert.equal(rows[0].article_names, 'Article A, Article B')
  })

  it('several sessions by one article on one date: one day', () => {
    const [row] = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '11:00'),
      session('A', 'Acme', '2026-09-01', '14:00', '17:00'),
    ], TODAY)

    assert.equal(row.attendance_days, 1)
  })

  it('depends only on attendance dates, never on checkout timestamps — so session-closure rules cannot move Days', () => {
    const base = [
      session('A', 'Acme', '2026-09-01', '09:00', '13:00'),
      session('B', 'Acme', '2026-09-01', '10:00', '14:00'),
      session('A', 'Acme', '2026-09-02', '09:00', '10:00'),
      session('A', 'Acme', '2026-09-20', '09:00', '10:00'),
    ]
    const closedAs = (checkedOutAt: (r: RawSessionRecord) => string | null) =>
      deriveClientWorkDuration(base.map(r => ({ ...r, checked_out_at: checkedOutAt(r) })), TODAY)

    const sameDay        = closedAs(r => r.checked_out_at)                                  // closed on its date
    const stillOpen      = closedAs(() => null)                                              // never closed
    const multiDay       = closedAs(() => '2026-10-08T08:30:00.000Z')                        // old deactivation behaviour
    const cappedAtMidnight = closedAs(r => `${r.attendance_date}T18:29:59.000Z`)             // 23:59:59 IST of its own date

    assert.deepEqual(stillOpen, sameDay)
    assert.deepEqual(multiDay, sameDay)
    assert.deepEqual(cappedAtMidnight, sameDay)
    assert.deepEqual(sameDay.map(r => r.attendance_days), [2, 1])   // WS1: 09-01 + 09-02, WS2: 09-20
  })

  it('a slot carries exactly the report fields — no hours / duration', () => {
    const [row] = deriveClientWorkDuration([session('A', 'Acme', '2026-09-01', '09:00', '13:00')], TODAY)

    assert.deepEqual(Object.keys(row).sort(), [
      'article_names', 'articles_count', 'attendance_days', 'client_name',
      'first_date', 'last_date', 'slot_number', 'status',
    ])
  })

  it('splits slots on a gap of more than 7 days between punch dates; exactly 7 stays together', () => {
    const together = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '10:00'),
      session('A', 'Acme', '2026-09-08', '09:00', '10:00'),   // 7 days later
    ], TODAY)
    const apart = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '10:00'),
      session('A', 'Acme', '2026-09-09', '09:00', '10:00'),   // 8 days later
    ], TODAY)

    assert.deepEqual(together.map(r => [r.slot_number, r.attendance_days]), [['WS1', 2]])
    assert.deepEqual(
      apart.map(r => [r.slot_number, r.attendance_days, r.first_date]),
      [['WS1', 1, '2026-09-01'], ['WS2', 1, '2026-09-09']]
    )
  })

  it('slot gaps use the client\'s combined dates across articles', () => {
    // A alone has a 13-day gap, but B's punch in between keeps one slot alive.
    const rows = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '10:00'),
      session('B', 'Acme', '2026-09-07', '09:00', '10:00'),
      session('A', 'Acme', '2026-09-14', '09:00', '10:00'),
    ], TODAY)

    assert.equal(rows.length, 1)
    assert.equal(rows[0].attendance_days, 3)
    assert.equal(rows[0].articles_count, 2)
  })

  it('status is Active when the last punch is within 7 days of today, else Completed', () => {
    const active    = deriveClientWorkDuration([session('A', 'Acme', '2026-10-01', '09:00', '10:00')], TODAY)  // 7 days
    const completed = deriveClientWorkDuration([session('A', 'Acme', '2026-09-30', '09:00', '10:00')], TODAY)  // 8 days

    assert.equal(active[0].status, 'Active')
    assert.equal(completed[0].status, 'Completed')
  })

  it('keeps clients separate and orders Active first, then oldest first punch, then client name', () => {
    const rows = deriveClientWorkDuration([
      session('A', 'Acme',  '2026-09-01', '09:00', '10:00'),   // Completed
      session('B', 'Acme',  '2026-10-06', '09:00', '10:00'),   // Active, WS2
      session('C', 'Beta',  '2026-10-05', '09:00', '11:00'),   // Active
      session('A', 'Gamma', '2026-09-10', '09:00', '10:30'),   // Completed
    ], TODAY)

    assert.deepEqual(
      rows.map(r => [r.client_name, r.slot_number, r.status, r.first_date]),
      [
        ['Beta',  'WS1', 'Active',    '2026-10-05'],
        ['Acme',  'WS2', 'Active',    '2026-10-06'],
        ['Acme',  'WS1', 'Completed', '2026-09-01'],
        ['Gamma', 'WS1', 'Completed', '2026-09-10'],
      ]
    )
  })

  it('returns no rows for no records', () => {
    assert.deepEqual(deriveClientWorkDuration([], TODAY), [])
  })
})
