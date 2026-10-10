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
// Columns: Department Type (the slot's distinct work types), then Work Days (distinct client dates) and
// Article Days (distinct article + client + date).
// Hours is no longer part of Client Analytics, and nothing is called "Man Days".
const HEADERS = ['Client Name', 'No. of Articles', 'Article Names', 'Department Type', 'Work Days', 'Article Days', 'First Punch', 'Last Punch', 'Status', 'Work Slot No.']
const COL = { client: 0, articles: 1, names: 2, department: 3, workDays: 4, articleDays: 5, first: 6, last: 7, status: 8, slot: 9 }
const SLOT_FIELDS = ['article_days', 'article_names', 'articles_count', 'attendance_days', 'client_name', 'department_types', 'first_date', 'last_date', 'slot_number', 'status']
const FORBIDDEN_TERMS = /hour|man[ -]?days?/i
const EXPORT_ALL = 'export=all_clients'

let seq = 0
function session(
  article: string, client: string | null, date: string, from: string, to: string, workType?: string | null,
): FakeAttendanceRow {
  seq += 1
  return {
    id:              `rec-${String(seq).padStart(5, '0')}`,
    article_id:      article,
    attendance_date: date,
    checked_in_at:   `${date}T${from}:00+00:00`,
    checked_out_at:  `${date}T${to}:00+00:00`,
    profiles:        { full_name: `Article ${article}` },
    assignments:     client === null ? null : { client_name: client, work_type: workType },
  }
}

// Three clients with different slot shapes, plus an unallocated punch.
//   Acme   WS1 09-01..09-02 (2 articles share 09-01; Audit + Tax, Audit repeated), WS2 09-20 (Advisory),
//          WS3 10-06 (Active; no work type)
//   Beta   WS1 10-05 (two sessions that day, GST both times, Active)
//   Gamma & Co.  WS1 09-10 (blank work type)
function fixture(): FakeAttendanceRow[] {
  return [
    session('A', 'Acme', '2026-09-01', '09:00', '13:00', 'Audit'),
    session('B', 'Acme', '2026-09-01', '10:00', '14:00', 'Tax'),      // same date as A, another department
    session('A', 'Acme', '2026-09-02', '09:00', '10:00', 'Audit'),    // Audit again: listed once
    session('A', 'Acme', '2026-09-20', '09:00', '11:30', 'Advisory'), // >7 days after 09-02
    session('B', 'Acme', '2026-10-06', '09:00', '10:00', null),       // >7 days after 09-20; missing work type
    session('C', 'Beta', '2026-10-05', '09:00', '12:00', 'GST'),
    session('C', 'Beta', '2026-10-05', '14:00', '16:00', 'GST'),      // second session, same date, same department
    session('A', 'Gamma & Co.', '2026-09-10', '08:00', '09:30', '   '),   // blank work type
    session('A', null, '2026-10-07', '09:00', '12:00'),               // unallocated: no client, must never appear
  ]
}

// Work Days vs Article Days for Acme: WS1 has A and B on 09-01 plus A on 09-02, so 2 dates but 3 article-days.
// Department Type is per slot: WS1 Audit + Tax, WS2 Advisory only (no leakage), WS3 none recorded.
const ACME_ROWS: Partial<ClientWorkSlot>[] = [
  { client_name: 'Acme', slot_number: 'WS3', articles_count: 1, article_names: 'Article B', department_types: '', attendance_days: 1, article_days: 1, status: 'Active',    first_date: '2026-10-06', last_date: '2026-10-06' },
  { client_name: 'Acme', slot_number: 'WS1', articles_count: 2, article_names: 'Article A, Article B', department_types: 'Audit, Tax', attendance_days: 2, article_days: 3, status: 'Completed', first_date: '2026-09-01', last_date: '2026-09-02' },
  { client_name: 'Acme', slot_number: 'WS2', articles_count: 1, article_names: 'Article A', department_types: 'Advisory', attendance_days: 1, article_days: 1, status: 'Completed', first_date: '2026-09-20', last_date: '2026-09-20' },
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
  [r.client_name, r.articles_count, r.article_names, r.department_types, r.attendance_days, r.article_days, fmtDate(r.first_date), fmtDate(r.last_date), r.status, r.slot_number]

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

    it('Work Days counts distinct client dates; Article Days counts each article on each date', async () => {
      const { rows } = await rowsFor(forClient('Acme'))
      const ws1 = rows.find(r => r.slot_number === 'WS1')

      assert.equal(ws1?.attendance_days, 2)   // two dates: 09-01 and 09-02
      assert.equal(ws1?.article_days, 3)      // A and B on 09-01, A on 09-02
    })

    it('two sessions of one article on one date: Work Days 1, Article Days 1', async () => {
      const { rows } = await rowsFor(forClient('Beta'))
      assert.deepEqual(pick(rows, ['client_name', 'slot_number', 'attendance_days', 'article_days', 'status']), [
        { client_name: 'Beta', slot_number: 'WS1', attendance_days: 1, article_days: 1, status: 'Active' },
      ])
    })

    it('no row carries Hours — only the report fields are returned', async () => {
      for (const client of ['Acme', 'Beta', 'Gamma & Co.']) {
        const { rows } = await rowsFor(forClient(client))
        assert.ok(rows.length > 0, client)
        for (const row of rows) {
          assert.deepEqual(Object.keys(row).sort(), SLOT_FIELDS, client)
          assert.ok(!Object.keys(row).some(k => FORBIDDEN_TERMS.test(k)), `${client}: no hours / man-days field`)
        }
      }
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
      assert.ok(!headers.some(h => FORBIDDEN_TERMS.test(String(h))), 'no hours / man-days column')
      assert.ok(rows.every(r => r.length === HEADERS.length), 'no extra cells')
      assert.deepEqual(rows, screenRows.map(toSheetRow))
      assert.equal(rows.length, 3)
      assert.deepEqual(rows.map(r => r[COL.workDays]), [1, 2, 1])      // Work Days, unchanged: WS3, WS1, WS2
      assert.deepEqual(rows.map(r => r[COL.articleDays]), [1, 3, 1])   // Article Days: WS3, WS1, WS2
      // Department Type, the same text as on screen (empty when the slot has no recorded work type)
      assert.deepEqual(rows.map(r => r[COL.department] ?? ''), ['', 'Audit, Tax', 'Advisory'])
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

    it('has Department Type, then Work Days, then Article Days, and no hours / man-days column', async () => {
      const { headers, rows } = await exportAll()

      assert.deepEqual(headers.slice(COL.department, COL.articleDays + 1), ['Department Type', 'Work Days', 'Article Days'])
      assert.ok(!headers.some(h => FORBIDDEN_TERMS.test(String(h))))
      assert.ok(rows.length > 0)
      assert.ok(rows.every(r => r.length === HEADERS.length), 'no extra cells')
    })

    it('contains every client\'s slots, aggregated, in the existing management order', async () => {
      const { rows } = await exportAll()

      assert.deepEqual(
        // client, slot, status, Work Days, Article Days, Department Type ('' when none recorded)
        rows.map(r => [r[COL.client], r[COL.slot], r[COL.status], r[COL.workDays], r[COL.articleDays], r[COL.department] ?? '']),
        [
          ['Beta',        'WS1', 'Active',    1, 1, 'GST'],
          ['Acme',        'WS3', 'Active',    1, 1, ''],
          ['Acme',        'WS1', 'Completed', 2, 3, 'Audit, Tax'],
          ['Gamma & Co.', 'WS1', 'Completed', 1, 1, ''],
          ['Acme',        'WS2', 'Completed', 1, 1, 'Advisory'],
        ]
      )
    })

    it('Department Type lists each slot\'s own distinct departments only — no duplicates, nothing blank, no leakage', async () => {
      const { rows } = await exportAll()
      const departmentOf = (client: string, slot: string) =>
        rows.find(r => r[COL.client] === client && r[COL.slot] === slot)?.[COL.department] ?? ''

      assert.equal(departmentOf('Acme', 'WS1'), 'Audit, Tax')   // Audit used twice, listed once; Tax by a second article
      assert.equal(departmentOf('Acme', 'WS2'), 'Advisory')     // not "Audit, Tax, Advisory": other slots do not leak in
      assert.equal(departmentOf('Acme', 'WS3'), '')             // missing work type: empty, not "null"
      assert.equal(departmentOf('Beta', 'WS1'), 'GST')          // two GST sessions, listed once
      assert.equal(departmentOf('Gamma & Co.', 'WS1'), '')      // whitespace-only work type counts as blank
    })

    it('each client\'s rows are exactly its own on-screen (single-client) rows', async () => {
      const { rows } = await exportAll()

      for (const client of ['Acme', 'Beta', 'Gamma & Co.']) {
        const alone = (await rowsFor(forClient(client))).rows
        assert.deepEqual(rows.filter(r => r[COL.client] === client), alone.map(toSheetRow), client)
      }
    })

    it('excludes unallocated / Others punches', async () => {
      const { rows } = await exportAll()

      const sum = (column: number) => rows.reduce((total, r) => total + (r[column] as number), 0)

      assert.ok(!rows.some(r => r[COL.last] === fmtDate('2026-10-07')))   // Last Punch: the unallocated punch's date never appears
      assert.equal(sum(COL.workDays), (1 + 2 + 1) + 1 + 1)      // Work Days: Acme 4, Beta 1, Gamma 1 — the unallocated punch adds no day
      assert.equal(sum(COL.articleDays), (1 + 3 + 1) + 1 + 1)   // Article Days: Acme 5, Beta 1, Gamma 1 — ...and no article-day
    })

    it('uses one server-side attendance stream — no per-client requests', async () => {
      const { calls } = await exportAll()

      assert.equal(calls.filter(c => c.startsWith('select:')).length, 1)
      assert.ok(calls.find(c => c.startsWith('select:'))?.includes('assignments!inner'))
      // The fake returns whole rows whatever is selected, so assert the real query really asks for the department.
      assert.match(calls.find(c => c.startsWith('select:')) ?? '', /assignments!inner\([^)]*work_type/)
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
      assert.equal(new Set(rows.map(r => r[COL.client])).size, 40)
      assert.equal(rows.reduce((sum, r) => sum + (r[COL.workDays] as number), 0), 2300)      // Work Days: every session landed in exactly one slot
      assert.equal(rows.reduce((sum, r) => sum + (r[COL.articleDays] as number), 0), 2300)   // Article Days: one article, one session per date
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
