// Route-level tests for GET /api/export/client-work-duration (Client Analytics),
// run through the real handler against an in-memory Supabase fake:
//   - ?client_name=<name>           the on-screen single-client report (JSON) and
//                                   its Excel export — behaviour unchanged
//   - ?export=all_clients           EXPORT-ONLY .xlsx of every client, aggregated
//                                   server-side from one query stream. There is
//                                   no JSON form of the all-client report.
// The calculations themselves are pinned in clientWorkDuration.test.ts; here
// the point is the query/mode plumbing, that "All" can only ever be an .xlsx,
// parity between the All sheet and the per-client results, permissions and the
// Excel export.
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { NextRequest } from 'next/server'
import { GET } from '../src/app/api/export/client-work-duration/route.ts'
import { setSupabase } from './support/supabaseServerStub.ts'
import { createFakeSupabase, type FakeAttendanceRow } from './support/fakeSupabase.ts'
import type { ClientWorkSlot } from '../src/lib/workDuration.ts'

// Frozen clock: 2026-10-08 11:30 IST.
const NOW   = '2026-10-08T06:00:00Z'
const TODAY = '2026-10-08'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const HEADERS = ['Client Name', 'No. of Articles', 'Article Names', 'Days Punched', 'Hours Punched', 'First Punch', 'Last Punch', 'Status', 'Work Slot No.']
const EXPORT_ALL = 'export=all_clients'

let seq = 0
function session(
  article: string, client: string | null, date: string, from: string, to: string,
): FakeAttendanceRow {
  seq += 1
  return {
    id:              `rec-${String(seq).padStart(5, '0')}`,
    article_id:      article,
    attendance_date: date,
    checked_in_at:   `${date}T${from}:00+00:00`,
    checked_out_at:  `${date}T${to}:00+00:00`,
    profiles:        { full_name: `Article ${article}` },
    assignments:     client === null ? null : { client_name: client },
  }
}

// Three clients with different slot shapes, plus an unallocated punch.
//   Acme   WS1 09-01..09-02 (2 articles share 09-01), WS2 09-20, WS3 10-06 (Active)
//   Beta   WS1 10-05 (two sessions that day, Active)
//   Gamma & Co.  WS1 09-10
function fixture(): FakeAttendanceRow[] {
  return [
    session('A', 'Acme', '2026-09-01', '09:00', '13:00'),   // 4h
    session('B', 'Acme', '2026-09-01', '10:00', '14:00'),   // 4h, same date as A
    session('A', 'Acme', '2026-09-02', '09:00', '10:00'),   // 1h
    session('A', 'Acme', '2026-09-20', '09:00', '11:30'),   // 2.5h, >7 days after 09-02
    session('B', 'Acme', '2026-10-06', '09:00', '10:00'),   // 1h, >7 days after 09-20
    session('C', 'Beta', '2026-10-05', '09:00', '12:00'),   // 3h
    session('C', 'Beta', '2026-10-05', '14:00', '16:00'),   // 2h
    session('A', 'Gamma & Co.', '2026-09-10', '08:00', '09:30'),   // 1.5h
    session('A', null, '2026-10-07', '09:00', '12:00'),     // unallocated: no client, must never appear
  ]
}

const ACME_ROWS: Partial<ClientWorkSlot>[] = [
  { client_name: 'Acme', slot_number: 'WS3', articles_count: 1, article_names: 'Article B', attendance_days: 1, total_hours: 1,   status: 'Active',    first_date: '2026-10-06', last_date: '2026-10-06' },
  { client_name: 'Acme', slot_number: 'WS1', articles_count: 2, article_names: 'Article A, Article B', attendance_days: 2, total_hours: 9, status: 'Completed', first_date: '2026-09-01', last_date: '2026-09-02' },
  { client_name: 'Acme', slot_number: 'WS2', articles_count: 1, article_names: 'Article A', attendance_days: 1, total_hours: 2.5, status: 'Completed', first_date: '2026-09-20', last_date: '2026-09-20' },
]

interface CallOptions {
  rows?:            FakeAttendanceRow[]
  role?:            string
  status?:          string
  unauthenticated?: boolean
}

async function call(query: string, options: CallOptions = {}) {
  const fake = createFakeSupabase({
    rows:   options.rows ?? fixture(),
    role:   options.role,
    status: options.status,
  })
  setSupabase(options.unauthenticated
    ? { ...fake.client, auth: { getUser: async () => ({ data: { user: null } }) } }
    : fake.client)
  const res = await GET(new NextRequest(`http://localhost/api/export/client-work-duration?${query}`))
  return { res, calls: fake.calls }
}

// Single-client JSON, as the page loads it.
async function rowsFor(query: string, rows?: FakeAttendanceRow[]) {
  const { res, calls } = await call(`${query}&format=json`, { rows })
  assert.equal(res.status, 200)
  const body = await res.json() as { rows: ClientWorkSlot[] }
  return { rows: body.rows, calls }
}

const forClient = (name: string) => `client_name=${encodeURIComponent(name)}`

function pick(rows: ClientWorkSlot[], keys: Array<keyof ClientWorkSlot>) {
  return rows.map(r => Object.fromEntries(keys.map(k => [k, r[k]])))
}

// ── Excel helpers ────────────────────────────────────────────────────────────
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN')   // as export.ts renders dates

// A JSON slot as it appears in a sheet row.
const toSheetRow = (r: ClientWorkSlot) =>
  [r.client_name, r.articles_count, r.article_names, r.attendance_days, r.total_hours, fmtDate(r.first_date), fmtDate(r.last_date), r.status, r.slot_number]

async function readSheet(res: Response) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await res.arrayBuffer())
  const ws = wb.getWorksheet('Client Analytics')
  assert.ok(ws, 'worksheet "Client Analytics" exists')
  const matrix = Array.from({ length: ws.rowCount }, (_, i) => (ws.getRow(i + 1).values as unknown[]).slice(1))
  return { headers: matrix[0], rows: matrix.slice(1) }
}

async function exportAll(options: CallOptions = {}) {
  const { res, calls } = await call(EXPORT_ALL, options)
  assert.equal(res.status, 200)
  return { res, calls, ...(await readSheet(res.clone())) }
}

describe('GET /api/export/client-work-duration', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['Date'], now: new Date(NOW) })
  })
  afterEach(() => {
    mock.timers.reset()
    setSupabase(null)
  })

  // ── Single client: existing on-screen behaviour ────────────────────────────
  describe('individual client (unchanged behaviour)', () => {
    it('returns that client\'s work slots only', async () => {
      const { rows, calls } = await rowsFor(forClient('Acme'))

      assert.deepEqual(rows, ACME_ROWS)
      assert.ok(calls.includes('eq:assignments.client_name:Acme'))
    })

    it('Days combines articles and Hours sums every session', async () => {
      const { rows } = await rowsFor(forClient('Acme'))
      const ws1 = rows.find(r => r.slot_number === 'WS1')

      assert.equal(ws1?.attendance_days, 2)   // 09-01 (A and B) + 09-02: not 3 man-days
      assert.equal(ws1?.total_hours, 9)       // 4 + 4 + 1 man-hours
    })

    it('two sessions on one date count as one day and both add to Hours', async () => {
      const { rows } = await rowsFor(forClient('Beta'))
      assert.deepEqual(pick(rows, ['client_name', 'slot_number', 'attendance_days', 'total_hours', 'status']), [
        { client_name: 'Beta', slot_number: 'WS1', attendance_days: 1, total_hours: 5, status: 'Active' },
      ])
    })

    it('a client name with no attendance yields no rows', async () => {
      const { rows } = await rowsFor(forClient('Nobody'))
      assert.deepEqual(rows, [])
    })

    it('still requires client_name, without querying attendance', async () => {
      const { res, calls } = await call('format=json')

      assert.equal(res.status, 400)
      assert.deepEqual(await res.json(), { error: 'client_name is required' })
      assert.equal(calls.length, 0)
    })
  })

  // ── Individual client Excel: unchanged ─────────────────────────────────────
  describe('individual client Excel export (unchanged)', () => {
    it('sheet and file are named Client Analytics; same columns and values as the on-screen rows', async () => {
      const { res } = await call(forClient('Acme'))

      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), XLSX_TYPE)
      assert.equal(res.headers.get('content-disposition'), `attachment; filename="client_analytics_Acme_${TODAY}.xlsx"`)

      const { headers, rows } = await readSheet(res)
      const screenRows = (await rowsFor(forClient('Acme'))).rows

      assert.deepEqual(headers, HEADERS)
      assert.deepEqual(rows, screenRows.map(toSheetRow))
      assert.equal(rows.length, 3)
    })

    it('file name sanitises special characters in a client name', async () => {
      const { res } = await call(forClient('Gamma & Co.'))
      assert.equal(res.headers.get('content-disposition'), `attachment; filename="client_analytics_Gamma_Co__${TODAY}.xlsx"`)
    })
  })

  // ── Export All Clients ─────────────────────────────────────────────────────
  describe('Export All Clients (export=all_clients)', () => {
    it('returns an .xlsx only — a real workbook, not JSON', async () => {
      const { res } = await call(EXPORT_ALL)

      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), XLSX_TYPE)
      assert.ok(!(res.headers.get('content-type') ?? '').includes('json'))
      const bytes = new Uint8Array(await res.arrayBuffer())
      assert.deepEqual([bytes[0], bytes[1]], [0x50, 0x4b])   // "PK" — the zip container every .xlsx is
    })

    it('is named client_analytics_All_Clients_<date>.xlsx with a "Client Analytics" sheet and the usual columns', async () => {
      const { res, headers } = await exportAll()

      assert.equal(res.headers.get('content-disposition'), `attachment; filename="client_analytics_All_Clients_${TODAY}.xlsx"`)
      assert.deepEqual(headers, HEADERS)
    })

    it('contains every client\'s slots, aggregated, in the existing management order', async () => {
      const { rows } = await exportAll()

      assert.deepEqual(
        rows.map(r => [r[0], r[8], r[7], r[3], r[4]]),   // client, slot, status, days, hours
        [
          ['Beta',        'WS1', 'Active',    1, 5],
          ['Acme',        'WS3', 'Active',    1, 1],
          ['Acme',        'WS1', 'Completed', 2, 9],
          ['Gamma & Co.', 'WS1', 'Completed', 1, 1.5],
          ['Acme',        'WS2', 'Completed', 1, 2.5],
        ]
      )
    })

    it('each client\'s rows are exactly its own on-screen (single-client) rows', async () => {
      const { rows } = await exportAll()

      for (const client of ['Acme', 'Beta', 'Gamma & Co.']) {
        const alone = (await rowsFor(forClient(client))).rows
        assert.deepEqual(rows.filter(r => r[0] === client), alone.map(toSheetRow), client)
      }
    })

    it('excludes unallocated / Others punches', async () => {
      const { rows } = await exportAll()

      assert.ok(!rows.some(r => r[6] === fmtDate('2026-10-07')))
      assert.equal(rows.reduce((sum, r) => sum + (r[4] as number), 0), 9 + 2.5 + 1 + 5 + 1.5)   // 19; the 3h unallocated punch is not in it
    })

    it('uses one server-side attendance stream — no per-client requests', async () => {
      const { calls } = await exportAll()

      assert.equal(calls.filter(c => c.startsWith('select:')).length, 1)
      assert.ok(calls.find(c => c.startsWith('select:'))?.includes('assignments!inner'))
      assert.equal(calls.filter(c => c.startsWith('eq:')).length, 0)
    })

    it('pages through a large history in one stream, not one query per client', async () => {
      // 2,300 sessions spread over 40 clients -> 3 pages of 1000, not 40 queries.
      const base = Date.UTC(2020, 0, 1)
      const bulk = Array.from({ length: 2300 }, (_, i) => {
        const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10)
        return session('Z', `Client ${String(i % 40).padStart(2, '0')}`, date, '09:00', '10:00')
      })
      const { rows, calls } = await exportAll({ rows: bulk })

      assert.deepEqual(calls.filter(c => c.startsWith('range:')), ['range:0-999', 'range:1000-1999', 'range:2000-2999'])
      assert.equal(calls.filter(c => c.startsWith('eq:')).length, 0)
      assert.equal(new Set(rows.map(r => r[0])).size, 40)
      assert.equal(rows.reduce((sum, r) => sum + (r[3] as number), 0), 2300)   // every session landed in exactly one slot
    })
  })

  // ── "All" can never be a JSON report ───────────────────────────────────────
  describe('All clients is not available as a JSON / on-screen report', () => {
    it('export=all_clients with format=json is rejected, with no attendance query and no rows', async () => {
      const { res, calls } = await call(`${EXPORT_ALL}&format=json`)
      const body = await res.json() as Record<string, unknown>

      assert.equal(res.status, 400)
      assert.deepEqual(body, { error: 'All-client analytics is available as an Excel export only' })
      assert.ok(!('rows' in body))
      assert.equal(calls.length, 0)
    })

    it('the old scope=all mode is gone — JSON and Excel forms are both rejected', async () => {
      for (const query of ['scope=all&format=json', 'scope=all']) {
        const { res, calls } = await call(query)
        assert.equal(res.status, 400, query)
        assert.deepEqual(await res.json(), { error: 'client_name is required' }, query)
        assert.equal(calls.length, 0, query)
      }
    })

    it('scope is simply an unknown parameter now: scope=all&client_name=X is the plain single-client request', async () => {
      const plain  = await rowsFor(forClient('Acme'))
      const legacy = await rowsFor(`scope=all&${forClient('Acme')}`)

      assert.deepEqual(legacy.rows, plain.rows)
      assert.deepEqual(legacy.calls, plain.calls)
    })

    it('export=all_clients cannot be combined with client_name', async () => {
      const { res, calls } = await call(`${EXPORT_ALL}&${forClient('Acme')}`)

      assert.equal(res.status, 400)
      assert.deepEqual(await res.json(), { error: 'client_name cannot be combined with export=all_clients' })
      assert.equal(calls.length, 0)
    })

    it('rejects any other export value', async () => {
      for (const query of ['export=bogus', 'export=all', 'export=']) {
        const { res, calls } = await call(`${query}&${forClient('Acme')}&format=json`)
        assert.equal(res.status, 400, query)
        assert.deepEqual(await res.json(), { error: 'Unsupported export' }, query)
        assert.equal(calls.length, 0, query)
      }
    })
  })

  // ── Permissions (identical for every mode) ─────────────────────────────────
  describe('permissions', () => {
    const modes = [
      ['individual client (JSON)',  `${forClient('Acme')}&format=json`],
      ['individual client (Excel)', forClient('Acme')],
      ['Export All Clients',        EXPORT_ALL],
    ] as const

    for (const [label, query] of modes) {
      it(`${label}: unauthenticated is rejected (401), no attendance read`, async () => {
        const { res, calls } = await call(query, { unauthenticated: true })
        assert.equal(res.status, 401)
        assert.equal(calls.length, 0)
      })

      for (const role of ['article', 'intern']) {
        it(`${label}: ${role} role is forbidden, no attendance read`, async () => {
          const { res, calls } = await call(query, { role })
          assert.equal(res.status, 403)
          assert.equal(calls.length, 0)
        })
      }

      for (const status of ['pending', 'deactivated']) {
        it(`${label}: ${status} account is forbidden`, async () => {
          const { res } = await call(query, { role: 'admin', status })
          assert.equal(res.status, 403)
        })
      }

      for (const role of ['admin', 'partner', 'manager']) {
        it(`${label}: ${role} is allowed`, async () => {
          const { res } = await call(query, { role })
          assert.equal(res.status, 200)
        })
      }
    }
  })
})
