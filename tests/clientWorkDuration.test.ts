// Characterization tests for deriveClientWorkDuration (Client Analytics).
// These pin the CURRENT semantics so adding the "All" scope (or anything else)
// can't silently change them:
//   Days  = distinct attendance dates on which the client had >= 1 punch,
//           combining all articles (NOT man-days)
//   Hours = sum of (checked_out - checked_in) over every closed session of the
//           client, across all articles (man-hours)
// Open / auto-closed session handling is deliberately NOT pinned here — it is
// a separate, pending investigation.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveClientWorkDuration, type RawSessionRecord } from '../src/lib/workDuration.ts'

const TODAY = '2026-10-08'

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
  it('Days counts a date once however many articles punched it; Hours sums every session (man-hours)', () => {
    const rows = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '13:00'),   // 4h
      session('B', 'Acme', '2026-09-01', '10:00', '14:00'),   // 4h, overlaps A by 3h, same date
    ], TODAY)

    assert.equal(rows.length, 1)
    assert.equal(rows[0].attendance_days, 1)        // not 2 (man-days)
    assert.equal(rows[0].total_hours, 8)            // not 5 (wall-clock), 4 + 4
    assert.equal(rows[0].articles_count, 2)
    assert.equal(rows[0].article_names, 'Article A, Article B')
  })

  it('several sessions by one article on one date: one day, hours add up', () => {
    const [row] = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '11:00'),   // 2h
      session('A', 'Acme', '2026-09-01', '14:00', '17:00'),   // 3h
    ], TODAY)

    assert.equal(row.attendance_days, 1)
    assert.equal(row.total_hours, 5)
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

  it('rounds hours once per slot to one decimal', () => {
    const [row] = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '09:20'),
      session('A', 'Acme', '2026-09-01', '10:00', '10:20'),
      session('A', 'Acme', '2026-09-01', '11:00', '11:20'),
    ], TODAY)

    assert.equal(row.total_hours, 1)   // 60 min exactly
  })

  it('returns no rows for no records', () => {
    assert.deepEqual(deriveClientWorkDuration([], TODAY), [])
  })
})
