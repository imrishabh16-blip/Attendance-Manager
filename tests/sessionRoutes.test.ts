// Route-level tests for the four ways an open attendance session gets closed,
// through the real handlers against a stateful in-memory database:
//   A. next check-in closing a stale session      POST  /api/attendance/checkin
//   B. admin deactivation                         PATCH /api/users/[id]  {action:'deactivate'}
//   C. role change out of article/intern          PATCH /api/users/[id]  {action:'change_role'}
//   D. manual check-out                           POST  /api/attendance/checkout
// Rule under test (lib/sessionClosure): checked_out_at = min(closing time,
// 23:59:59 IST of the session's attendance_date) — a session never spans dates.
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST as checkIn } from '../src/app/api/attendance/checkin/route.ts'
import { POST as checkOut } from '../src/app/api/attendance/checkout/route.ts'
import { PATCH as patchUser } from '../src/app/api/users/[id]/route.ts'
import { setSupabase } from './support/supabaseServerStub.ts'
import { setAdminSupabase } from './support/supabaseAdminStub.ts'
import { createMemoryDb, type Row } from './support/memoryDb.ts'

// A moment given in IST wall-clock terms; also what the frozen clock is set to.
const ist = (date: string, time: string) => new Date(`${date}T${time}+05:30`)
const setNow = (date: Date) => mock.timers.setTime(date.getTime())

// 23:59:59 IST on 8 Oct, as stored.
const END_OF_8_OCT = '2026-10-08T18:29:59.000Z'

// What an admin sees when closing the open session fails — never the raw database error.
const CLOSE_FAILED = "Could not close the user's open attendance session. No changes were made. Please try again."
const RAW_DB_ERROR = 'connection reset by peer (db-host-internal:5432)'

const ARTICLE = { id: 'art-1', role: 'article', status: 'active', full_name: 'Article One' }
const OTHER   = { id: 'art-2', role: 'article', status: 'active', full_name: 'Article Two' }
const ADMIN   = { id: 'admin-1', role: 'admin', status: 'active', full_name: 'Admin' }

// An article's open session on 8 Oct, checked in at 09:00 IST.
function openSession(over: Row = {}): Row {
  return {
    id: 'sess-1', article_id: 'art-1', assignment_id: null, attendance_type: 'unallocated',
    attendance_date: '2026-10-08', checked_in_at: '2026-10-08T03:30:00.000Z', checked_out_at: null, note: null,
    ...over,
  }
}

function boot(tables: Record<string, Row[]>, userId: string) {
  const db = createMemoryDb(tables, userId)
  setSupabase(db.client)
  setAdminSupabase(db.client)
  return db
}

const session = (db: ReturnType<typeof boot>, id = 'sess-1') => db.tables.attendance_records.find(r => r.id === id)!

// Whole-calendar-date check: is this instant on the given IST date?
const istDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

describe('session closure', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['Date'], now: ist('2026-10-08', '10:00:00') }) })
  afterEach(() => { mock.timers.reset(); mock.restoreAll(); setSupabase(null); setAdminSupabase(null) })

  // ── D. manual check-out ────────────────────────────────────────────────────
  describe('D. manual check-out', () => {
    const post = (body: Record<string, unknown>) =>
      checkOut(new NextRequest('http://localhost/api/attendance/checkout', {
        method: 'POST',
        body: JSON.stringify({ record_id: 'sess-1', latitude: 19.07, longitude: 72.87, ...body }),
      }))

    it('same-day check-out -> the actual check-out time', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [openSession()] }, 'art-1')
      setNow(ist('2026-10-08', '15:30:00'))

      const res = await post({})

      assert.equal(res.status, 200)
      assert.equal(session(db).checked_out_at, ist('2026-10-08', '15:30:00').toISOString())
      assert.equal(session(db).attendance_date, '2026-10-08')
      assert.equal(session(db).checked_out_lat, 19.07)   // GPS still recorded
    })

    it('next-day check-out -> 23:59:59 IST of the ORIGINAL attendance date', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [openSession()] }, 'art-1')
      setNow(ist('2026-10-09', '10:30:00'))

      const res = await post({})

      assert.equal(res.status, 200)
      assert.equal(session(db).checked_out_at, END_OF_8_OCT)
      assert.equal(session(db).attendance_date, '2026-10-08')
    })

    it('days later (tab left open for ages / forged record_id) is capped the same way', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [openSession()] }, 'art-1')
      setNow(ist('2026-10-25', '09:00:00'))

      await post({})

      assert.equal(session(db).checked_out_at, END_OF_8_OCT)
    })

    it('around IST midnight: 23:59:58 is kept, 00:00:01 is capped', async () => {
      const before = boot({ profiles: [ARTICLE], attendance_records: [openSession()] }, 'art-1')
      setNow(ist('2026-10-08', '23:59:58'))
      await post({})
      assert.equal(session(before).checked_out_at, ist('2026-10-08', '23:59:58').toISOString())

      const after = boot({ profiles: [ARTICLE], attendance_records: [openSession()] }, 'art-1')
      setNow(ist('2026-10-09', '00:00:01'))
      await post({})
      assert.equal(session(after).checked_out_at, END_OF_8_OCT)
    })

    it('a session started at 23:30 IST and checked out at 00:30 IST stays on its own date', async () => {
      const db = boot({
        profiles: [ARTICLE],
        attendance_records: [openSession({ checked_in_at: ist('2026-10-08', '23:30:00').toISOString() })],
      }, 'art-1')
      setNow(ist('2026-10-09', '00:30:00'))

      await post({})

      const out = session(db).checked_out_at as string
      assert.equal(out, END_OF_8_OCT)
      assert.equal(istDate(out), session(db).attendance_date)
    })

    it('the UTC date is not mistaken for the IST date (01:30 IST on 9 Oct is still 8 Oct in UTC)', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [openSession()] }, 'art-1')
      setNow(new Date('2026-10-08T20:00:00.000Z'))

      await post({})

      assert.equal(session(db).checked_out_at, END_OF_8_OCT)
    })

    it('never writes a future timestamp', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [openSession()] }, 'art-1')
      const now = ist('2026-10-08', '14:00:00')
      setNow(now)

      await post({})

      assert.ok(new Date(session(db).checked_out_at as string).getTime() <= now.getTime())
    })

    it('an already-closed session is not touched (409)', async () => {
      const closedAt = '2026-10-08T10:00:00.000Z'
      const db = boot({ profiles: [ARTICLE], attendance_records: [openSession({ checked_out_at: closedAt })] }, 'art-1')
      setNow(ist('2026-10-09', '10:30:00'))

      const res = await post({})

      assert.equal(res.status, 409)
      assert.equal(session(db).checked_out_at, closedAt)
    })

    it('another article\'s session is forbidden and untouched', async () => {
      const db = boot({ profiles: [OTHER], attendance_records: [openSession()] }, 'art-2')

      const res = await post({})

      assert.equal(res.status, 403)
      assert.equal(session(db).checked_out_at, null)
    })

    it('keeps the existing note unless a new one is sent (unchanged behaviour)', async () => {
      const keep = boot({ profiles: [ARTICLE], attendance_records: [openSession({ note: 'At client site' })] }, 'art-1')
      await post({})
      assert.equal(session(keep).note, 'At client site')

      const replace = boot({ profiles: [ARTICLE], attendance_records: [openSession({ note: 'At client site' })] }, 'art-1')
      await post({ note: 'Done for the day' })
      assert.equal(session(replace).note, 'Done for the day')
    })
  })

  // ── A. next check-in closing a stale session ───────────────────────────────
  describe('A. next check-in closes a stale session', () => {
    const post = () =>
      checkIn(new NextRequest('http://localhost/api/attendance/checkin', {
        method: 'POST',
        body: JSON.stringify({ attendance_type: 'unallocated', latitude: 19.07, longitude: 72.87 }),
      }))
    const stale = (date: string, over: Row = {}) => openSession({
      attendance_date: date, checked_in_at: ist(date, '09:00:00').toISOString(), ...over,
    })

    it('closes yesterday\'s forgotten session at 23:59:59 IST of ITS date and then checks in (existing behaviour unchanged)', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [stale('2026-10-07')] }, 'art-1')
      setNow(ist('2026-10-08', '10:00:00'))

      const res = await post()

      assert.equal(res.status, 201)
      assert.equal(session(db).checked_out_at, '2026-10-07T18:29:59.000Z')   // 23:59:59 IST on 7 Oct
      assert.equal(session(db).note, 'Auto-closed: check-out not recorded')
      assert.equal(session(db).attendance_date, '2026-10-07')
      const opened = db.tables.attendance_records.filter(r => r.checked_out_at == null)
      assert.equal(opened.length, 1)
      assert.equal(opened[0].attendance_date, '2026-10-08')
    })

    it('a session forgotten days ago is closed at the end of ITS date, not of today', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [stale('2026-10-01')] }, 'art-1')
      setNow(ist('2026-10-08', '10:00:00'))

      await post()

      assert.equal(session(db).checked_out_at, '2026-10-01T18:29:59.000Z')
    })

    it('the closed session stays within its date', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [stale('2026-10-07')] }, 'art-1')
      setNow(ist('2026-10-08', '10:00:00'))

      await post()

      assert.equal(istDate(session(db).checked_out_at as string), '2026-10-07')
    })

    it('keeps a note the article wrote at check-in and appends the marker', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [stale('2026-10-07', { note: 'Visited client office' })] }, 'art-1')
      setNow(ist('2026-10-08', '10:00:00'))

      await post()

      assert.equal(session(db).note, 'Visited client office — Auto-closed: check-out not recorded')
    })

    it('a session still open TODAY blocks check-in (409) and is not closed', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [openSession()] }, 'art-1')
      setNow(ist('2026-10-08', '10:00:00'))

      const res = await post()

      assert.equal(res.status, 409)
      assert.equal(session(db).checked_out_at, null)
      assert.equal(db.tables.attendance_records.length, 1)
    })

    it('if the stale close fails the check-in is aborted (500) and nothing new is created', async () => {
      const db = boot({ profiles: [ARTICLE], attendance_records: [stale('2026-10-07')] }, 'art-1')
      db.failNext('update', 'attendance_records')
      setNow(ist('2026-10-08', '10:00:00'))

      const res = await post()

      assert.equal(res.status, 500)
      assert.equal(session(db).checked_out_at, null)
      assert.equal(db.tables.attendance_records.length, 1)
    })

    it('check-in itself still stamps the IST date (23:30 IST and 00:10 IST)', async () => {
      const lateDb = boot({ profiles: [ARTICLE], attendance_records: [] }, 'art-1')
      setNow(ist('2026-10-08', '23:30:00'))
      await post()
      assert.equal(lateDb.tables.attendance_records[0].attendance_date, '2026-10-08')   // UTC date is also 8 Oct here

      const earlyDb = boot({ profiles: [ARTICLE], attendance_records: [] }, 'art-1')
      setNow(ist('2026-10-09', '00:10:00'))
      await post()
      assert.equal(earlyDb.tables.attendance_records[0].attendance_date, '2026-10-09')  // UTC date would still be 8 Oct
    })
  })

  // ── B & C. admin deactivation / role change ────────────────────────────────
  describe('admin actions on a user with an open session', () => {
    const patch = (body: Record<string, unknown>, id = 'art-1') =>
      patchUser(
        new NextRequest(`http://localhost/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
        { params: Promise.resolve({ id }) }
      )
    const world = (extra: Row[] = [openSession()]) =>
      boot({ profiles: [ADMIN, ARTICLE, OTHER], attendance_records: extra, audit_log: [] }, 'admin-1')
    const profile = (db: ReturnType<typeof boot>, id = 'art-1') => db.tables.profiles.find(p => p.id === id)!

    describe('B. deactivate', () => {
      it('same-day deactivation -> the actual deactivation time', async () => {
        const db = world()
        setNow(ist('2026-10-08', '14:00:00'))

        const res = await patch({ action: 'deactivate' })

        assert.equal(res.status, 200)
        assert.equal(session(db).checked_out_at, ist('2026-10-08', '14:00:00').toISOString())
        assert.equal(session(db).note, 'Auto-closed: user deactivated')
        assert.equal(profile(db).status, 'deactivated')
      })

      it('later-date deactivation -> 23:59:59 IST of the ORIGINAL attendance date (the 08 Oct -> 20 Oct case)', async () => {
        const db = world()
        setNow(ist('2026-10-20', '14:00:00'))

        const res = await patch({ action: 'deactivate' })

        assert.equal(res.status, 200)
        assert.equal(session(db).checked_out_at, END_OF_8_OCT)
        assert.equal(session(db).attendance_date, '2026-10-08')
        assert.equal(istDate(session(db).checked_out_at as string), '2026-10-08')   // one calendar date, not 13
        // the profile still records WHEN the admin acted
        assert.equal(profile(db).deactivated_at, ist('2026-10-20', '14:00:00').toISOString())
        assert.equal(profile(db).deactivated_by, 'admin-1')
      })

      it('never writes a future checked_out_at', async () => {
        const db = world()
        const now = ist('2026-10-08', '14:00:00')
        setNow(now)

        await patch({ action: 'deactivate' })

        assert.ok(new Date(session(db).checked_out_at as string).getTime() <= now.getTime())
      })

      it('just before / just after IST midnight', async () => {
        const before = world()
        setNow(ist('2026-10-08', '23:59:58'))
        await patch({ action: 'deactivate' })
        assert.equal(session(before).checked_out_at, ist('2026-10-08', '23:59:58').toISOString())

        const after = world()
        setNow(ist('2026-10-09', '00:00:01'))
        await patch({ action: 'deactivate' })
        assert.equal(session(after).checked_out_at, END_OF_8_OCT)
      })

      it('keeps a note the article wrote and appends the marker', async () => {
        const db = world([openSession({ note: 'At client site' })])
        setNow(ist('2026-10-20', '14:00:00'))

        await patch({ action: 'deactivate' })

        assert.equal(session(db).note, 'At client site — Auto-closed: user deactivated')
      })

      it('closes only the target\'s open session; other articles and closed history are untouched', async () => {
        const db = world([
          openSession(),
          openSession({ id: 'other-open', article_id: 'art-2' }),
          openSession({ id: 'old-closed', attendance_date: '2026-10-01', checked_in_at: '2026-10-01T03:30:00.000Z', checked_out_at: '2026-10-01T10:00:00.000Z' }),
        ])
        setNow(ist('2026-10-20', '14:00:00'))

        await patch({ action: 'deactivate' })

        assert.equal(session(db).checked_out_at, END_OF_8_OCT)
        assert.equal(session(db, 'other-open').checked_out_at, null)
        assert.equal(session(db, 'old-closed').checked_out_at, '2026-10-01T10:00:00.000Z')
        assert.equal(profile(db, 'art-2').status, 'active')
      })

      it('no open session -> deactivates normally, no attendance write', async () => {
        const db = world([])
        setNow(ist('2026-10-20', '14:00:00'))

        const res = await patch({ action: 'deactivate' })

        assert.equal(res.status, 200)
        assert.equal(profile(db).status, 'deactivated')
        assert.ok(!db.ops.some(o => o.table === 'attendance_records' && o.op === 'update'))
      })

      it('if the close fails the deactivation is aborted (500) and the profile is untouched', async () => {
        const db = world()
        db.failNext('update', 'attendance_records', RAW_DB_ERROR)
        const logged = mock.method(console, 'error', () => {})
        setNow(ist('2026-10-20', '14:00:00'))

        const res = await patch({ action: 'deactivate' })

        assert.equal(res.status, 500)
        assert.deepEqual(await res.json(), { error: CLOSE_FAILED })   // not the raw database error
        assert.equal(logged.mock.callCount(), 1)                      // ...which stays in the server log
        assert.equal((logged.mock.calls[0].arguments[1] as { message: string }).message, RAW_DB_ERROR)
        assert.equal(profile(db).status, 'active')
        assert.equal(session(db).checked_out_at, null)
        assert.equal(db.tables.audit_log.length, 0)
      })

      it('if the open-session LOOKUP fails the deactivation is aborted (500), nothing changes, and a retry completes it', async () => {
        // Policy: "no open session" is success, but a real database error is not — even a failed
        // lookup, since we cannot tell whether there is a session to close.
        const db = world()
        db.failNext('select', 'attendance_records', RAW_DB_ERROR)
        const logged = mock.method(console, 'error', () => {})
        setNow(ist('2026-10-20', '14:00:00'))

        const res = await patch({ action: 'deactivate' })
        const body = await res.json() as { error: string }

        assert.equal(res.status, 500)
        assert.deepEqual(body, { error: CLOSE_FAILED })
        assert.ok(!JSON.stringify(body).includes(RAW_DB_ERROR), 'raw database error is not exposed')
        assert.equal(logged.mock.callCount(), 1)
        assert.equal((logged.mock.calls[0].arguments[1] as { message: string }).message, RAW_DB_ERROR)
        // nothing was changed: profile still active, session still open and untouched, no audit entry, no write attempted
        assert.equal(profile(db).status, 'active')
        assert.equal(profile(db).deactivated_at, undefined)
        assert.equal(session(db).checked_out_at, null)
        assert.equal(session(db).note, null)
        assert.equal(db.tables.audit_log.length, 0)
        assert.ok(!db.ops.some(o => o.op === 'update'), 'no UPDATE of any table was attempted')

        // the failure was transient, so simply trying again completes the action
        const retry = await patch({ action: 'deactivate' })
        assert.equal(retry.status, 200)
        assert.equal(session(db).checked_out_at, END_OF_8_OCT)
        assert.equal(profile(db).status, 'deactivated')
      })

      it('records the audit entry as before', async () => {
        const db = world()
        setNow(ist('2026-10-20', '14:00:00'))

        await patch({ action: 'deactivate' })

        assert.equal(db.tables.audit_log.length, 1)
        assert.equal(db.tables.audit_log[0].action, 'user.deactivate')
        assert.equal(db.tables.audit_log[0].target_id, 'art-1')
      })

      it('a non-admin cannot deactivate, and nothing is closed (permissions unchanged)', async () => {
        const db = boot({ profiles: [ARTICLE, OTHER], attendance_records: [openSession()], audit_log: [] }, 'art-2')

        const res = await patch({ action: 'deactivate' })

        assert.equal(res.status, 403)
        assert.equal(session(db).checked_out_at, null)
      })
    })

    describe('C. role change out of article/intern', () => {
      it('same-day role change -> the actual action time', async () => {
        const db = world()
        setNow(ist('2026-10-08', '14:00:00'))

        const res = await patch({ action: 'change_role', role: 'manager' })

        assert.equal(res.status, 200)
        assert.equal(session(db).checked_out_at, ist('2026-10-08', '14:00:00').toISOString())
        assert.equal(session(db).note, 'Auto-closed: role changed')
        assert.equal(profile(db).role, 'manager')
      })

      it('later-date role change -> 23:59:59 IST of the ORIGINAL attendance date', async () => {
        const db = world()
        setNow(ist('2026-10-20', '14:00:00'))

        const res = await patch({ action: 'change_role', role: 'manager' })

        assert.equal(res.status, 200)
        assert.equal(session(db).checked_out_at, END_OF_8_OCT)
        assert.equal(istDate(session(db).checked_out_at as string), '2026-10-08')
        assert.equal(profile(db).role, 'manager')
      })

      it('keeps the article\'s note and appends the marker', async () => {
        const db = world([openSession({ note: 'At client site' })])
        setNow(ist('2026-10-20', '14:00:00'))

        await patch({ action: 'change_role', role: 'partner' })

        assert.equal(session(db).note, 'At client site — Auto-closed: role changed')
      })

      it('article <-> intern does NOT close the session (checkout access is unaffected)', async () => {
        const db = world()
        setNow(ist('2026-10-20', '14:00:00'))

        const res = await patch({ action: 'change_role', role: 'intern' })

        assert.equal(res.status, 200)
        assert.equal(session(db).checked_out_at, null)
        assert.equal(profile(db).role, 'intern')
      })

      it('if the close fails the role change is aborted (500) and the role is unchanged', async () => {
        const db = world()
        db.failNext('update', 'attendance_records', RAW_DB_ERROR)
        const logged = mock.method(console, 'error', () => {})
        setNow(ist('2026-10-20', '14:00:00'))

        const res = await patch({ action: 'change_role', role: 'manager' })

        assert.equal(res.status, 500)
        assert.deepEqual(await res.json(), { error: CLOSE_FAILED })
        assert.equal(logged.mock.callCount(), 1)
        assert.equal(profile(db).role, 'article')
        assert.equal(session(db).checked_out_at, null)
      })

      it('if the open-session LOOKUP fails the role change is aborted (500) and the role is unchanged', async () => {
        const db = world()
        db.failNext('select', 'attendance_records', RAW_DB_ERROR)
        const logged = mock.method(console, 'error', () => {})
        setNow(ist('2026-10-20', '14:00:00'))

        const res = await patch({ action: 'change_role', role: 'manager' })
        const body = await res.json() as { error: string }

        assert.equal(res.status, 500)
        assert.deepEqual(body, { error: CLOSE_FAILED })
        assert.ok(!JSON.stringify(body).includes(RAW_DB_ERROR), 'raw database error is not exposed')
        assert.equal(logged.mock.callCount(), 1)
        assert.equal(profile(db).role, 'article')
        assert.equal(session(db).checked_out_at, null)
        assert.equal(db.tables.audit_log.length, 0)
        assert.ok(!db.ops.some(o => o.op === 'update'), 'no UPDATE of any table was attempted')
      })
    })
  })
})
