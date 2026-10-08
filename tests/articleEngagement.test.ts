// Unit tests for deriveArticleEngagementDuration (Client Engagement).
// Rule under test: for each article, pick the client of its latest
// client-assigned punch (by checked_in_at), then compute Days / First / Last
// Attendance from that Article + Client combination only.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveArticleEngagementDuration, type RawSessionRecord } from '../src/lib/workDuration.ts'
import { toSessionRecords, type RawAttendanceRow } from '../src/lib/attendanceRecords.ts'

// One punch. checked_in_at defaults to `time` on the attendance date (UTC).
function punch(articleId: string, client: string, date: string, time = '09:00'): RawSessionRecord {
  return {
    article_id:      articleId,
    article_name:    `Article ${articleId}`,
    client_name:     client,
    attendance_date: date,
    checked_in_at:   `${date}T${time}:00+00:00`,
    checked_out_at:  null,
  }
}

// punches for consecutive days in one month: dayRange('2026-09', 1, 13) -> 13 dates
function dayRange(yearMonth: string, from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `${yearMonth}-${String(from + i).padStart(2, '0')}`)
}

describe('deriveArticleEngagementDuration', () => {
  // 1 ─────────────────────────────────────────────────────────────────────
  it('article with one client: days/first/last come from that client', () => {
    const rows = deriveArticleEngagementDuration([
      punch('A', 'Client X', '2026-09-03'),
      punch('A', 'Client X', '2026-09-04'),
      punch('A', 'Client X', '2026-09-04', '14:00'), // second session, same day
      punch('A', 'Client X', '2026-09-10'),
    ])

    assert.deepEqual(rows, [{
      article_id:          'A',
      article_name:        'Article A',
      last_punched_client: 'Client X',
      days:                3,                // 09-03, 09-04, 09-10 — two sessions on 09-04 count once
      first_attendance:    '2026-09-03',
      last_attendance:     '2026-09-10',
    }])
  })

  // 2 ─────────────────────────────────────────────────────────────────────
  it('multiple clients, latest client has fewer days: counts only the latest client', () => {
    // Y: 13 days (Sep 1-13). X: 5 days (Sep 20-24), latest punch is X.
    // Old logic returned Client X | 18 | 2026-09-01 | 2026-09-24.
    const rows = deriveArticleEngagementDuration([
      ...dayRange('2026-09', 20, 24).map(d => punch('A', 'Client X', d)),
      ...dayRange('2026-09', 1, 13).map(d => punch('A', 'Client Y', d)),
    ])

    assert.equal(rows.length, 1)
    assert.equal(rows[0].last_punched_client, 'Client X')
    assert.equal(rows[0].days, 5)
    assert.equal(rows[0].first_attendance, '2026-09-20')
    assert.equal(rows[0].last_attendance, '2026-09-24')
  })

  it('multiple clients, latest client has MORE days: still only the latest client', () => {
    // Guards against a "max days" implementation: Y has 2 days, X has 4 and is latest.
    const rows = deriveArticleEngagementDuration([
      punch('A', 'Client Y', '2026-09-01'),
      punch('A', 'Client Y', '2026-09-02'),
      ...dayRange('2026-09', 10, 13).map(d => punch('A', 'Client X', d)),
    ])

    assert.equal(rows[0].last_punched_client, 'Client X')
    assert.equal(rows[0].days, 4)
    assert.equal(rows[0].first_attendance, '2026-09-10')
  })

  it('earlier clients are ignored even when the article went back and forth', () => {
    // Y, then X, then Y again: the last punch is Y, so X's days must not count.
    const rows = deriveArticleEngagementDuration([
      punch('A', 'Client Y', '2026-09-01'),
      punch('A', 'Client X', '2026-09-05'),
      punch('A', 'Client X', '2026-09-06'),
      punch('A', 'Client Y', '2026-09-12'),
    ])

    assert.equal(rows[0].last_punched_client, 'Client Y')
    assert.equal(rows[0].days, 2)                       // Y: 09-01, 09-12 (not the 4 article days)
    assert.equal(rows[0].first_attendance, '2026-09-01')
    assert.equal(rows[0].last_attendance, '2026-09-12')
  })

  // 3 ─────────────────────────────────────────────────────────────────────
  describe('overlapping attendance dates between clients', () => {
    const y = [1, 2, 3, 4].map(d => punch('A', 'Client Y', `2026-10-0${d}`))

    it('shared dates count for the latest client; other clients dates do not', () => {
      const rows = deriveArticleEngagementDuration([
        ...y,                                         // Y: Oct 1-4
        punch('A', 'Client X', '2026-10-03', '14:00'), // shared with Y
        punch('A', 'Client X', '2026-10-04', '14:00'), // shared with Y
        punch('A', 'Client X', '2026-10-04', '16:00'), // latest punch overall; second X session on Oct 4
      ])

      assert.equal(rows[0].last_punched_client, 'Client X')
      assert.equal(rows[0].days, 2)                       // Oct 3, Oct 4 — not 4 (article) and not 6 (sum of sessions)
      assert.equal(rows[0].first_attendance, '2026-10-03')
      assert.equal(rows[0].last_attendance, '2026-10-04')
    })

    it('the same data with Y as the latest client counts Y\'s own 4 dates', () => {
      const rows = deriveArticleEngagementDuration([
        ...y,
        punch('A', 'Client X', '2026-10-03', '14:00'),
        punch('A', 'Client X', '2026-10-04', '14:00'),
        punch('A', 'Client Y', '2026-10-04', '18:00'), // Y punches last
      ])

      assert.equal(rows[0].last_punched_client, 'Client Y')
      assert.equal(rows[0].days, 4)                       // Oct 1-4; X's shared dates add nothing
      assert.equal(rows[0].first_attendance, '2026-10-01')
      assert.equal(rows[0].last_attendance, '2026-10-04')
    })

    it('both clients on a single shared day: the day counts once for the latest client', () => {
      const rows = deriveArticleEngagementDuration([
        punch('A', 'Client Y', '2026-10-05', '09:00'),
        punch('A', 'Client X', '2026-10-05', '15:00'),
      ])

      assert.equal(rows[0].last_punched_client, 'Client X')
      assert.equal(rows[0].days, 1)
      assert.equal(rows[0].first_attendance, '2026-10-05')
      assert.equal(rows[0].last_attendance, '2026-10-05')
    })
  })

  // 5 ─────────────────────────────────────────────────────────────────────
  describe('latest client is determined by checked_in_at', () => {
    it('does not depend on input order', () => {
      const records = [
        punch('A', 'Client Y', '2026-09-01'),
        punch('A', 'Client Y', '2026-09-02'),
        punch('A', 'Client X', '2026-09-09'),
      ]
      const forward  = deriveArticleEngagementDuration(records)
      const backward = deriveArticleEngagementDuration([...records].reverse())

      assert.equal(forward[0].last_punched_client, 'Client X')
      assert.deepEqual(backward, forward)
    })

    it('the later check-in wins on the same attendance date', () => {
      const rows = deriveArticleEngagementDuration([
        punch('A', 'Client X', '2026-09-09', '15:00'),
        punch('A', 'Client Y', '2026-09-09', '09:00'),
      ])
      assert.equal(rows[0].last_punched_client, 'Client X')
    })

    it('compares instants, not strings, across UTC offsets', () => {
      // Y checked in at 09:30+05:30 = 04:00Z; X at 05:00Z. X is later, although
      // "…T09:30…" sorts after "…T05:00…" as a string.
      const y = { ...punch('A', 'Client Y', '2026-10-01'), checked_in_at: '2026-10-01T09:30:00+05:30' }
      const x = { ...punch('A', 'Client X', '2026-10-01'), checked_in_at: '2026-10-01T05:00:00+00:00' }

      assert.equal(deriveArticleEngagementDuration([y, x])[0].last_punched_client, 'Client X')
      assert.equal(deriveArticleEngagementDuration([x, y])[0].last_punched_client, 'Client X')
    })

    it('uses checked_in_at rather than attendance_date to choose the client', () => {
      // Contrived (e.g. a backdated record): Y has the later attendance_date but
      // the earlier check-in instant. checked_in_at decides, as before.
      const y = { ...punch('A', 'Client Y', '2026-10-03'), checked_in_at: '2026-10-01T08:00:00+00:00' }
      const x = { ...punch('A', 'Client X', '2026-10-02'), checked_in_at: '2026-10-02T08:00:00+00:00' }

      const rows = deriveArticleEngagementDuration([y, x])
      assert.equal(rows[0].last_punched_client, 'Client X')
      assert.equal(rows[0].days, 1)
      assert.equal(rows[0].first_attendance, '2026-10-02')
      assert.equal(rows[0].last_attendance, '2026-10-02')
    })
  })

  // 7 ─────────────────────────────────────────────────────────────────────
  describe('identical checked_in_at keeps the existing >= tie behaviour (later input row wins)', () => {
    const at = '2026-09-09T09:00:00+00:00'
    const y = { ...punch('A', 'Client Y', '2026-09-09'), checked_in_at: at }
    const x = { ...punch('A', 'Client X', '2026-09-09'), checked_in_at: at }

    it('[Y, X] -> Client X', () => {
      assert.equal(deriveArticleEngagementDuration([y, x])[0].last_punched_client, 'Client X')
    })

    it('[X, Y] -> Client Y', () => {
      assert.equal(deriveArticleEngagementDuration([x, y])[0].last_punched_client, 'Client Y')
    })

    it('the tie winner\'s own dates are the ones counted', () => {
      const rows = deriveArticleEngagementDuration([
        punch('A', 'Client X', '2026-09-01'),
        punch('A', 'Client X', '2026-09-02'),
        y,
        x, // same instant as y, later in the list -> X wins
      ])

      assert.equal(rows[0].last_punched_client, 'Client X')
      assert.equal(rows[0].days, 3)                       // X: 09-01, 09-02, 09-09
      assert.equal(rows[0].first_attendance, '2026-09-01')
    })
  })

  // Row shape ─────────────────────────────────────────────────────────────
  it('returns one row per article, each computed independently, sorted by article name', () => {
    const rows = deriveArticleEngagementDuration([
      punch('B', 'Client Z', '2026-09-05'),
      punch('A', 'Client Y', '2026-09-01'),
      punch('A', 'Client X', '2026-09-08'),
      punch('B', 'Client X', '2026-09-02'),
      punch('B', 'Client X', '2026-09-03'),
      punch('B', 'Client Z', '2026-09-06'),
    ])

    assert.deepEqual(rows.map(r => r.article_name), ['Article A', 'Article B'])
    // A: latest is X (1 day). B: latest is Z (09-05, 09-06 = 2 days); B's X days are ignored.
    assert.deepEqual(
      rows.map(r => [r.last_punched_client, r.days, r.first_attendance, r.last_attendance]),
      [
        ['Client X', 1, '2026-09-08', '2026-09-08'],
        ['Client Z', 2, '2026-09-05', '2026-09-06'],
      ]
    )
  })

  it('returns no rows for no records', () => {
    assert.deepEqual(deriveArticleEngagementDuration([]), [])
  })
})

// 6 (record-mapping layer) ──────────────────────────────────────────────────
// The route's query uses assignments!inner, so Others/unallocated punches
// normally never reach the code. toSessionRecords() is the second guard: it
// drops any row without an assignment. Either way the selected client must not
// change. (The route-level test covers the query side.)
describe('Others / unallocated punches never reach the calculation', () => {
  const raw = (client: string | null, date: string, time: string): RawAttendanceRow => ({
    article_id:      'A',
    attendance_date: date,
    checked_in_at:   `${date}T${time}:00+00:00`,
    checked_out_at:  null,
    profiles:        { full_name: 'Article A' },
    assignments:     client === null ? null : { client_name: client },
  })

  it('an unallocated punch later than the latest client punch does not change the client', () => {
    const records = toSessionRecords([
      raw('Client Y', '2026-09-01', '09:00'),
      raw('Client Y', '2026-09-02', '09:00'),
      raw('Client X', '2026-09-08', '09:00'),
      raw(null,       '2026-09-09', '18:00'), // Others / unallocated, the article's very last punch
    ])
    const rows = deriveArticleEngagementDuration(records)

    assert.equal(rows.length, 1)
    assert.equal(rows[0].last_punched_client, 'Client X')
    assert.equal(rows[0].days, 1)
    assert.equal(rows[0].last_attendance, '2026-09-08')   // not 09-09
  })

  it('an article with only unallocated punches produces no row', () => {
    assert.deepEqual(deriveArticleEngagementDuration(toSessionRecords([raw(null, '2026-09-09', '18:00')])), [])
  })

  it('treats an empty embedded assignments array the same as no assignment', () => {
    const emptyEmbed: RawAttendanceRow = { ...raw('Client X', '2026-09-09', '18:00'), assignments: [] }
    assert.deepEqual(toSessionRecords([emptyEmbed]), [])
  })
})
