// Tests for lib/sessionClosure — the single rule for what checked_out_at a
// session gets when it is closed (or checked out late):
//   checked_out_at = min(closing time, 23:59:59 IST of the session's attendance_date)
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  effectiveCheckoutAt, endOfAttendanceDay, withAutoCloseNote, closeSessionRecord, closeOpenSession,
} from '../src/lib/sessionClosure.ts'
import { createMemoryDb } from './support/memoryDb.ts'

// A moment given in IST wall-clock terms (explicit offset, so the tests do not
// depend on the machine's timezone either).
const ist = (date: string, time: string) => new Date(`${date}T${time}+05:30`)

describe('effectiveCheckoutAt', () => {
  it('closed on the same IST date -> the actual time', () => {
    const at = ist('2026-10-08', '15:30:00')
    assert.equal(effectiveCheckoutAt('2026-10-08', at), at.toISOString())
  })

  it('closed on a later date -> 23:59:59 IST of the ORIGINAL attendance date', () => {
    assert.equal(effectiveCheckoutAt('2026-10-08', ist('2026-10-20', '14:00:00')), '2026-10-08T18:29:59.000Z')
    assert.equal(effectiveCheckoutAt('2026-10-08', ist('2026-10-09', '00:00:00')), '2026-10-08T18:29:59.000Z')
  })

  it('never produces a future timestamp, even for a same-day action earlier than 23:59:59', () => {
    const at = ist('2026-10-08', '14:00:00')
    assert.ok(new Date(effectiveCheckoutAt('2026-10-08', at)).getTime() <= at.getTime())
    assert.notEqual(effectiveCheckoutAt('2026-10-08', at), '2026-10-08T18:29:59.000Z')   // not pushed out to end of day
  })

  describe('IST midnight boundary', () => {
    it('23:59:58.999 IST is kept as is', () => {
      const at = ist('2026-10-08', '23:59:58.999')
      assert.equal(effectiveCheckoutAt('2026-10-08', at), at.toISOString())
    })

    it('exactly 23:59:59.000 IST is kept', () => {
      assert.equal(effectiveCheckoutAt('2026-10-08', ist('2026-10-08', '23:59:59.000')), '2026-10-08T18:29:59.000Z')
    })

    it('23:59:59.500 IST (same date) is capped to 23:59:59.000 — still the same IST date', () => {
      assert.equal(effectiveCheckoutAt('2026-10-08', ist('2026-10-08', '23:59:59.500')), '2026-10-08T18:29:59.000Z')
    })

    it('00:00:00.000 IST of the next date is capped back to the original date', () => {
      assert.equal(effectiveCheckoutAt('2026-10-08', ist('2026-10-09', '00:00:00.000')), '2026-10-08T18:29:59.000Z')
    })

    it('uses the IST date, not the UTC date: 01:30 IST on 9 Oct is still 8 Oct in UTC', () => {
      const at = new Date('2026-10-08T20:00:00.000Z')   // 2026-10-09 01:30 IST, but 2026-10-08 in UTC
      assert.equal(effectiveCheckoutAt('2026-10-08', at), '2026-10-08T18:29:59.000Z')
    })

    it('23:30 IST (18:00Z) on the attendance date is kept', () => {
      const at = new Date('2026-10-08T18:00:00.000Z')
      assert.equal(effectiveCheckoutAt('2026-10-08', at), at.toISOString())
    })
  })

  it('matches the previous stale-session rule exactly for any earlier date', () => {
    // The check-in route used to write new Date(`${date}T23:59:59+05:30`).toISOString().
    for (const date of ['2026-01-01', '2026-02-28', '2028-02-29', '2026-10-07', '2026-12-31']) {
      const legacy = new Date(`${date}T23:59:59+05:30`).toISOString()
      assert.equal(effectiveCheckoutAt(date, ist('2030-01-01', '10:00:00')), legacy, date)   // closed well after every date
    }
  })

  it('handles month, year and leap-day ends', () => {
    assert.equal(effectiveCheckoutAt('2026-12-31', ist('2027-01-01', '09:00:00')), '2026-12-31T18:29:59.000Z')
    assert.equal(effectiveCheckoutAt('2028-02-29', ist('2028-03-01', '09:00:00')), '2028-02-29T18:29:59.000Z')
    assert.equal(effectiveCheckoutAt('2026-09-30', ist('2026-10-01', '09:00:00')), '2026-09-30T18:29:59.000Z')
  })

  it('result is never later than the closing time nor than the end of the attendance date', () => {
    const base = Date.UTC(2026, 9, 1)
    for (let i = 0; i < 400; i++) {
      const at = new Date(base + i * 7_919_000)                    // spread over ~36 days, odd step
      const date = new Date(base + (i % 30) * 86_400_000).toISOString().slice(0, 10)
      const out = new Date(effectiveCheckoutAt(date, at))
      assert.ok(out.getTime() <= at.getTime(), `${date} @ ${at.toISOString()} not in the future`)
      assert.ok(out.getTime() <= endOfAttendanceDay(date).getTime(), `${date} stays within its date`)
    }
  })

  describe('independent of the server timezone', () => {
    const originalTZ = process.env.TZ
    afterEach(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ })

    const zones: Array<[string, number]> = [
      ['UTC', 0], ['Asia/Kolkata', -330], ['America/Los_Angeles', 420], ['Pacific/Kiritimati', -840],
    ]
    for (const [zone, expectedOffset] of zones) {
      it(`gives the same answers with TZ=${zone}`, () => {
        process.env.TZ = zone
        assert.equal(new Date('2026-10-08T12:00:00Z').getTimezoneOffset(), expectedOffset, 'TZ change took effect')

        assert.equal(effectiveCheckoutAt('2026-10-08', new Date('2026-10-20T08:30:00Z')), '2026-10-08T18:29:59.000Z')
        assert.equal(effectiveCheckoutAt('2026-10-08', new Date('2026-10-08T10:00:00Z')), '2026-10-08T10:00:00.000Z')
        assert.equal(effectiveCheckoutAt('2026-10-08', new Date('2026-10-08T18:30:00Z')), '2026-10-08T18:29:59.000Z')
        assert.equal(endOfAttendanceDay('2026-10-08').toISOString(), '2026-10-08T18:29:59.000Z')
      })
    }
  })

  it('rejects a malformed attendance date instead of guessing', () => {
    for (const bad of ['', '2026-10-8', '08-10-2026', '2026-13-01', 'not a date', '2026-10-08T00:00:00Z']) {
      assert.throws(() => effectiveCheckoutAt(bad, new Date()), /Invalid attendance date/, bad)
    }
  })
})

describe('withAutoCloseNote', () => {
  it('no existing note -> just the marker (unchanged from before)', () => {
    assert.equal(withAutoCloseNote(null, 'user deactivated'), 'Auto-closed: user deactivated')
    assert.equal(withAutoCloseNote(undefined, 'role changed'), 'Auto-closed: role changed')
    assert.equal(withAutoCloseNote('   ', 'check-out not recorded'), 'Auto-closed: check-out not recorded')
  })

  it('keeps an existing note and appends the marker', () => {
    assert.equal(
      withAutoCloseNote('Visited client office', 'user deactivated'),
      'Visited client office — Auto-closed: user deactivated'
    )
  })
})

// ── DB-level behaviour of the shared close functions ───────────────────────────
const open = (over: Record<string, unknown> = {}) => ({
  id: 'sess-1', article_id: 'art-1', attendance_date: '2026-10-08',
  checked_in_at: '2026-10-08T03:30:00.000Z', checked_out_at: null, note: null, ...over,
})

describe('closeSessionRecord', () => {
  it('closes an open session per the rule and keeps its note', async () => {
    const db = createMemoryDb({ attendance_records: [open({ note: 'Site visit' })] })
    const error = await closeSessionRecord(db.client as never, { id: 'sess-1', attendance_date: '2026-10-08', note: 'Site visit' },
      'user deactivated', ist('2026-10-20', '14:00:00'))

    assert.equal(error, null)
    assert.equal(db.tables.attendance_records[0].checked_out_at, '2026-10-08T18:29:59.000Z')
    assert.equal(db.tables.attendance_records[0].note, 'Site visit — Auto-closed: user deactivated')
    assert.equal(db.tables.attendance_records[0].attendance_date, '2026-10-08')   // never rewritten
  })

  it('cannot overwrite a session that was closed in the meantime', async () => {
    // We read the row while it was open, but the article checked out before our UPDATE ran.
    const alreadyClosed = '2026-10-08T10:00:00.000Z'
    const db = createMemoryDb({ attendance_records: [open({ checked_out_at: alreadyClosed, note: 'Left early' })] })
    const staleSnapshot = { id: 'sess-1', attendance_date: '2026-10-08', note: null }

    const error = await closeSessionRecord(db.client as never, staleSnapshot, 'user deactivated', ist('2026-10-20', '14:00:00'))

    assert.equal(error, null)
    assert.equal(db.tables.attendance_records[0].checked_out_at, alreadyClosed)   // untouched
    assert.equal(db.tables.attendance_records[0].note, 'Left early')              // note untouched too
  })

  it('returns the database error and leaves the session open when the UPDATE fails', async () => {
    const db = createMemoryDb({ attendance_records: [open()] })
    db.failNext('update', 'attendance_records', 'boom')

    const error = await closeSessionRecord(db.client as never, { id: 'sess-1', attendance_date: '2026-10-08', note: null }, 'role changed', new Date())

    assert.equal(error?.message, 'boom')
    assert.equal(db.tables.attendance_records[0].checked_out_at, null)
  })
})

describe('closeOpenSession', () => {
  it('closes only that article\'s open session and nothing else', async () => {
    const db = createMemoryDb({
      attendance_records: [
        open({ id: 'target-open' }),
        open({ id: 'target-old-closed', attendance_date: '2026-10-01', checked_in_at: '2026-10-01T03:30:00.000Z', checked_out_at: '2026-10-01T10:00:00.000Z' }),
        open({ id: 'other-open', article_id: 'art-2' }),
      ],
    })

    const error = await closeOpenSession(db.client as never, 'art-1', 'user deactivated', ist('2026-10-20', '14:00:00'))
    const byId = Object.fromEntries(db.tables.attendance_records.map(r => [r.id, r]))

    assert.equal(error, null)
    assert.equal(byId['target-open'].checked_out_at, '2026-10-08T18:29:59.000Z')
    assert.equal(byId['target-old-closed'].checked_out_at, '2026-10-01T10:00:00.000Z')   // history untouched
    assert.equal(byId['other-open'].checked_out_at, null)                                // other article untouched
  })

  it('same-day close uses the actual time; later-date close uses 23:59:59 of the original date', async () => {
    const sameDay = createMemoryDb({ attendance_records: [open()] })
    await closeOpenSession(sameDay.client as never, 'art-1', 'role changed', ist('2026-10-08', '14:00:00'))
    assert.equal(sameDay.tables.attendance_records[0].checked_out_at, '2026-10-08T08:30:00.000Z')

    const later = createMemoryDb({ attendance_records: [open()] })
    await closeOpenSession(later.client as never, 'art-1', 'role changed', ist('2026-10-20', '14:00:00'))
    assert.equal(later.tables.attendance_records[0].checked_out_at, '2026-10-08T18:29:59.000Z')
  })

  it('nothing open -> null and no write is attempted', async () => {
    const db = createMemoryDb({ attendance_records: [open({ checked_out_at: '2026-10-08T10:00:00.000Z' })] })
    const error = await closeOpenSession(db.client as never, 'art-1', 'user deactivated', new Date())

    assert.equal(error, null)
    assert.ok(!db.ops.some(o => o.op === 'update'))
  })

  it('does not treat a row that never checked in as an open session', async () => {
    const db = createMemoryDb({ attendance_records: [open({ checked_in_at: null })] })
    const error = await closeOpenSession(db.client as never, 'art-1', 'user deactivated', new Date())

    assert.equal(error, null)
    assert.ok(!db.ops.some(o => o.op === 'update'))
    assert.equal(db.tables.attendance_records[0].checked_out_at, null)
  })

  it('surfaces a lookup failure instead of silently treating it as "nothing to close"', async () => {
    const db = createMemoryDb({ attendance_records: [open()] })
    db.failNext('select', 'attendance_records', 'lookup failed')

    const error = await closeOpenSession(db.client as never, 'art-1', 'user deactivated', new Date())

    assert.equal(error?.message, 'lookup failed')
    assert.ok(!db.ops.some(o => o.op === 'update'))
    assert.equal(db.tables.attendance_records[0].checked_out_at, null)
  })
})
