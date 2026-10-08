// Route-level tests for GET /api/dashboard/article-engagement-duration.
// Runs the real handler (auth, query chain, toSessionRecords, derive, xlsx)
// against an in-memory Supabase fake, to cover what a pure function test
// cannot: the Start Date -> today bounds and the Others/unallocated exclusion.
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { NextRequest } from 'next/server'
import { GET } from '../src/app/api/dashboard/article-engagement-duration/route.ts'
import { setSupabase } from './support/supabaseServerStub.ts'
import { createFakeSupabase, type FakeAttendanceRow } from './support/fakeSupabase.ts'
import type { ArticleEngagementRow } from '../src/lib/workDuration.ts'

// Frozen clock: 2026-09-30 20:00 UTC is already 2026-10-01 01:30 IST, so a
// UTC-based "today" would be one day behind the route's IST "today".
const NOW         = '2026-09-30T20:00:00Z'
const TODAY_IST   = '2026-10-01'

let seq = 0
function row(articleId: string, client: string | null, date: string, time = '09:00'): FakeAttendanceRow {
  seq += 1
  return {
    id:              `rec-${String(seq).padStart(4, '0')}`,
    article_id:      articleId,
    attendance_date: date,
    checked_in_at:   `${date}T${time}:00+00:00`,
    checked_out_at:  null,
    profiles:        { full_name: `Article ${articleId}` },
    assignments:     client === null ? null : { client_name: client },
  }
}

function days(yearMonth: string, from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `${yearMonth}-${String(from + i).padStart(2, '0')}`)
}

// Article A: Client Y worked Sep 1-13 (13 days); Client X worked Sep 18-22
// (5 days) and is the latest client; then an Others/unallocated punch on Sep 25
// that is later than every client punch.
function articleAFixture(): FakeAttendanceRow[] {
  return [
    ...days('2026-09', 1, 13).map(d => row('A', 'Client Y', d)),
    ...days('2026-09', 18, 22).map(d => row('A', 'Client X', d)),
    row('A', null, '2026-09-25', '18:00'),
  ]
}

async function generate(rows: FakeAttendanceRow[], query: string) {
  const fake = createFakeSupabase({ rows })
  setSupabase(fake.client)
  const res = await GET(new NextRequest(`http://localhost/api/dashboard/article-engagement-duration?${query}`))
  return { res, calls: fake.calls }
}

async function rowsFor(rows: FakeAttendanceRow[], startDate: string) {
  const { res, calls } = await generate(rows, `start_date=${startDate}`)
  assert.equal(res.status, 200)
  const body = await res.json() as { rows: ArticleEngagementRow[] }
  return { rows: body.rows, calls }
}

describe('GET /api/dashboard/article-engagement-duration', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['Date'], now: new Date(NOW) })
  })
  afterEach(() => {
    mock.timers.reset()
    setSupabase(null)
  })

  it('shows the latest client with that client\'s days (5), not the article total (18)', async () => {
    const { rows } = await rowsFor(articleAFixture(), '2026-09-01')

    assert.deepEqual(rows, [{
      article_id:          'A',
      article_name:        'Article A',
      last_punched_client: 'Client X',
      days:                5,
      first_attendance:    '2026-09-18',
      last_attendance:     '2026-09-22',
    }])
  })

  // 6 ─ Others/unallocated
  it('an Others/unallocated punch later than the latest client punch does not change the row', async () => {
    const { rows } = await rowsFor(articleAFixture(), '2026-09-01')

    // The unallocated punch is on 2026-09-25 18:00 — later than every client punch.
    assert.equal(rows.length, 1)
    assert.equal(rows[0].last_punched_client, 'Client X')
    assert.equal(rows[0].last_attendance, '2026-09-22')
  })

  it('an article whose only punches in range are unallocated gets no row', async () => {
    const { rows } = await rowsFor(articleAFixture(), '2026-09-23')   // only the Sep 25 unallocated punch is in range
    assert.deepEqual(rows, [])
  })

  // 4 ─ Start Date boundary
  describe('Start Date boundary', () => {
    it('is inclusive: a client punch exactly on the Start Date counts', async () => {
      const { rows, calls } = await rowsFor(articleAFixture(), '2026-09-18')

      assert.ok(calls.includes('gte:attendance_date:2026-09-18'))
      assert.equal(rows[0].last_punched_client, 'Client X')
      assert.equal(rows[0].days, 5)
      assert.equal(rows[0].first_attendance, '2026-09-18')
    })

    it('excludes the latest client\'s own earlier days before the Start Date', async () => {
      const { rows } = await rowsFor(articleAFixture(), '2026-09-20')   // X keeps 20, 21, 22 only

      assert.equal(rows[0].last_punched_client, 'Client X')
      assert.equal(rows[0].days, 3)
      assert.equal(rows[0].first_attendance, '2026-09-20')
      assert.equal(rows[0].last_attendance, '2026-09-22')
    })

    it('drops other clients entirely when the Start Date is after all of their attendance', async () => {
      const { rows } = await rowsFor(articleAFixture(), '2026-09-14')   // Y (Sep 1-13) is out of range

      assert.equal(rows[0].last_punched_client, 'Client X')
      assert.equal(rows[0].days, 5)
    })

    it('a Start Date after every client punch yields no rows', async () => {
      const { rows } = await rowsFor(articleAFixture(), '2026-09-23')
      assert.deepEqual(rows, [])
    })

    it('is bounded above by today in IST (inclusive), not by the UTC date', async () => {
      const fixture = [
        row('B', 'Client Z', '2026-09-30'),
        row('B', 'Client Z', TODAY_IST),          // today in IST (UTC clock still says Sep 30)
        row('B', 'Client Z', '2026-10-02'),       // future — must be excluded
      ]
      const { rows, calls } = await rowsFor(fixture, '2026-09-01')

      assert.ok(calls.includes(`lte:attendance_date:${TODAY_IST}`))
      assert.equal(rows[0].days, 2)
      assert.equal(rows[0].last_attendance, TODAY_IST)
    })
  })

  it('issues a single bounded query (Start Date -> today) with the assignments inner join', async () => {
    const { calls } = await rowsFor(articleAFixture(), '2026-09-01')

    assert.equal(calls.filter(c => c.startsWith('select:')).length, 1)
    assert.ok(calls.find(c => c.startsWith('select:'))?.includes('assignments!inner'))
    assert.ok(calls.includes('gte:attendance_date:2026-09-01'))
    assert.ok(calls.includes(`lte:attendance_date:${TODAY_IST}`))
  })

  it('rejects a missing Start Date without querying attendance', async () => {
    const { res, calls } = await generate(articleAFixture(), '')

    assert.equal(res.status, 400)
    assert.equal(calls.length, 0)
  })

  it('Excel export uses the same corrected values as the modal', async () => {
    const { res } = await generate(articleAFixture(), 'start_date=2026-09-01&format=xlsx')
    assert.equal(res.status, 200)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.getWorksheet('Client Engagement')
    assert.ok(ws)

    assert.deepEqual(
      (ws.getRow(1).values as unknown[]).slice(1),
      ['Article Name', 'Last Punched Client', 'Days', 'First Attendance', 'Last Attendance']
    )
    assert.equal(ws.rowCount, 2)
    assert.equal(ws.getRow(2).getCell(1).value, 'Article A')
    assert.equal(ws.getRow(2).getCell(2).value, 'Client X')
    assert.equal(ws.getRow(2).getCell(3).value, 5)
  })
})
