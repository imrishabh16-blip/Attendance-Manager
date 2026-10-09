// Characterization tests for deriveClientWorkDuration (Client Analytics).
// These pin the semantics of the slot calculation so later changes can't
// silently alter them:
//   Work Days    (attendance_days) = distinct attendance dates on which the
//                client had >= 1 punch, combining all articles
//   Article Days (article_days)    = distinct (article, attendance date) pairs
//                for the client — several sessions by one article on one date
//                are one Article Day, several articles on one date are several
// Both count attendance_date only: never session duration, never open/closed
// state. Hours is no longer part of Client Analytics: a slot carries no
// duration field at all (asserted below).
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

// [Work Days, Article Days] of each slot, in slot order.
const days = (rows: ReturnType<typeof deriveClientWorkDuration>) => rows.map(r => [r.attendance_days, r.article_days])

describe('deriveClientWorkDuration', () => {
  it('Work Days counts a date once however many articles punched it', () => {
    const rows = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '13:00'),
      session('B', 'Acme', '2026-09-01', '10:00', '14:00'),   // second article, same date
    ], TODAY)

    assert.equal(rows.length, 1)
    assert.equal(rows[0].attendance_days, 1)        // one date, not one per article
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

  it('depends only on attendance dates, never on checkout timestamps — so session-closure rules cannot move Work Days or Article Days', () => {
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
    assert.deepEqual(sameDay.map(r => r.article_days), [3, 1])      // WS1: A+B on 09-01, A on 09-02; WS2: A on 09-20
  })

  it('a slot carries exactly the report fields — no hours / duration', () => {
    const [row] = deriveClientWorkDuration([session('A', 'Acme', '2026-09-01', '09:00', '13:00')], TODAY)

    assert.deepEqual(Object.keys(row).sort(), [
      'article_days', 'article_names', 'articles_count', 'attendance_days', 'client_name',
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

describe('Work Days and Article Days', () => {
  it('two sessions, same article / client / day -> Work Days 1, Article Days 1', () => {
    const rows = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '11:00'),
      session('A', 'Acme', '2026-09-01', '14:00', '17:00'),
    ], TODAY)

    assert.deepEqual(days(rows), [[1, 1]])
  })

  it('two articles, same client / day -> Work Days 1, Article Days 2', () => {
    const rows = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '13:00'),
      session('B', 'Acme', '2026-09-01', '10:00', '14:00'),
    ], TODAY)

    assert.deepEqual(days(rows), [[1, 2]])
  })

  it('same article / client on two dates -> Work Days 2, Article Days 2', () => {
    const rows = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '13:00'),
      session('A', 'Acme', '2026-09-02', '09:00', '13:00'),
    ], TODAY)

    assert.deepEqual(days(rows), [[2, 2]])
  })

  it('the same article with two clients on one day -> 1 Article Day for each client', () => {
    const rows = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '12:00'),
      session('A', 'Beta', '2026-09-01', '13:00', '17:00'),
    ], TODAY)

    assert.deepEqual(rows.map(r => [r.client_name, r.attendance_days, r.article_days]).sort(),
      [['Acme', 1, 1], ['Beta', 1, 1]])
  })

  it('open and closed sessions of one article on one day count once; an open session alone counts', () => {
    const closed = session('A', 'Acme', '2026-09-01', '09:00', '12:00')
    const open   = { ...session('A', 'Acme', '2026-09-01', '14:00', '17:00'), checked_out_at: null }

    assert.deepEqual(days(deriveClientWorkDuration([closed, open], TODAY)), [[1, 1]])   // not double-counted
    assert.deepEqual(days(deriveClientWorkDuration([open], TODAY)), [[1, 1]])           // still counts
  })

  it('a legacy multi-date checkout counts only on its attendance_date', () => {
    const forgotten = { ...session('A', 'Acme', '2026-09-01', '09:00', '17:00'), checked_out_at: '2026-09-20T08:30:00+00:00' }
    const [row] = deriveClientWorkDuration([forgotten, session('A', 'Acme', '2026-09-01', '18:00', '19:00')], TODAY)

    assert.equal(row.attendance_days, 1)
    assert.equal(row.article_days, 1)
    assert.equal(row.last_date, '2026-09-01')    // never extended to the checkout date
  })

  it('Article Days is counted per slot (>7-day split): each slot is distinct, and the slots add up to the client total', () => {
    const rows = deriveClientWorkDuration([
      session('A', 'Acme', '2026-09-01', '09:00', '10:00'),
      session('B', 'Acme', '2026-09-01', '09:00', '10:00'),
      session('A', 'Acme', '2026-09-02', '09:00', '10:00'),
      session('A', 'Acme', '2026-09-20', '09:00', '10:00'),   // 18 days later -> new slot, article A again
      session('B', 'Acme', '2026-09-21', '09:00', '10:00'),
    ], TODAY)

    // WS1: A+B on 09-01, A on 09-02 -> 2 Work Days, 3 Article Days.
    // WS2: A on 09-20, B on 09-21   -> 2 Work Days, 2 Article Days (A is counted again in its own slot).
    assert.deepEqual(rows.map(r => [r.slot_number, r.attendance_days, r.article_days]),
      [['WS1', 2, 3], ['WS2', 2, 2]])
    assert.equal(rows.reduce((sum, r) => sum + r.article_days, 0), 5)   // distinct (article, date) pairs overall
  })

  it('articles are told apart by id, not by display name', () => {
    const same = (id: string) => ({ ...session(id, 'Acme', '2026-09-01', '09:00', '12:00'), article_name: 'Priya Shah' })
    const [row] = deriveClientWorkDuration([same('A'), same('B')], TODAY)

    assert.equal(row.article_days, 2)
    assert.equal(row.articles_count, 2)
  })

  describe('randomized check against a plain Set oracle', () => {
    const mulberry32 = (a: number) => () => {
      a |= 0; a = a + 0x6D2B79F5 | 0
      let t = Math.imul(a ^ a >>> 15, 1 | a)
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
      return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
    const day = (n: number) => new Date(Date.UTC(2026, 6, 1) + n * 86_400_000).toISOString().slice(0, 10)
    const gap = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

    it('matches an independent count for 30 random data sets', () => {
      for (let seed = 1; seed <= 30; seed++) {
        const rnd = mulberry32(seed)
        const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
        const records = Array.from({ length: 80 }, () => {
          const r = session(pick(['A', 'B', 'C', 'D']), pick(['Acme', 'Beta', 'Gamma']), day(Math.floor(rnd() * 70)), '09:00', '17:00')
          const x = rnd()
          return x < 0.2 ? { ...r, checked_out_at: null }                                      // open
               : x < 0.35 ? { ...r, checked_out_at: '2026-12-31T00:00:00+00:00' } : r         // legacy multi-date checkout
        })
        const rows = deriveClientWorkDuration(records, TODAY)

        for (const client of ['Acme', 'Beta', 'Gamma']) {
          const mine  = records.filter(r => r.client_name === client)
          const dates = [...new Set(mine.map(r => r.attendance_date))].sort()
          const slots: string[][] = []
          for (const d of dates) {
            const last = slots[slots.length - 1]
            if (last && gap(last[last.length - 1], d) <= 7) last.push(d); else slots.push([d])
          }
          const got = rows.filter(r => r.client_name === client).sort((a, b) => Number(a.slot_number.slice(2)) - Number(b.slot_number.slice(2)))

          assert.equal(got.length, slots.length, `seed ${seed} / ${client}: slot count`)
          let totalArticleDays = 0
          slots.forEach((ds, i) => {
            const inSlot = mine.filter(r => ds.includes(r.attendance_date))
            const want   = new Set(inSlot.map(r => `${r.article_id}/${r.attendance_date}`)).size
            assert.equal(got[i].attendance_days, ds.length, `seed ${seed} / ${client} / slot ${i + 1}: Work Days`)
            assert.equal(got[i].article_days, want, `seed ${seed} / ${client} / slot ${i + 1}: Article Days`)
            assert.ok(got[i].article_days >= got[i].attendance_days)
            assert.ok(got[i].article_days <= got[i].attendance_days * got[i].articles_count)
            totalArticleDays += got[i].article_days
          })
          assert.equal(totalArticleDays, new Set(mine.map(r => `${r.article_id}/${r.attendance_date}`)).size, `seed ${seed} / ${client}: slots add up`)
        }
      }
    })
  })
})
