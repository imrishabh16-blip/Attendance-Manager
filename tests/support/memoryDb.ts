// Stateful in-memory stand-in for the slice of the Supabase/PostgREST client
// used by the attendance session routes (check-in, check-out, user admin).
// Unlike fakeSupabase.ts (a read-only fake of one Client Analytics query),
// this one holds tables and applies insert / update / select, so tests can
// assert what actually ends up in the rows.
//
// Deliberately small, and strict: it supports only the calls those routes
// make and throws on anything else. It models:
//   - eq / is(null) / not(is null) filters, select() projection of plain column lists
//   - single() / maybeSingle() with PostgREST's "more than one row" error
//   - insert + update, optionally returning rows via .select()
//   - the UNIQUE partial index idx_attendance_one_open_session_per_article
//     (one row per article with checked_in_at set and checked_out_at null)
//   - the updated_at trigger
//   - one-shot failure injection, to test "abort when the close fails"
// It does NOT model RLS: the "user" and "admin" clients are the same object.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>

export interface DbError { code?: string; message: string; details: null; hint: null }
type Result = { data: unknown; error: DbError | null }
type Mode = 'many' | 'single' | 'maybeSingle'

const defined = (row: Row): Row => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined))

export function createMemoryDb(initial: Record<string, Row[]>, userId: string | null = null) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map(r => ({ ...r }))

  const ops: Array<{ op: string; table: string }> = []
  const failures: Array<{ op: string; table: string; message: string }> = []
  let seq = 0

  const table = (name: string) => (tables[name] ??= [])
  const err = (message: string, code?: string): DbError => ({ code, message, details: null, hint: null })

  class Query implements PromiseLike<Result> {
    private op: 'select' | 'insert' | 'update' = 'select'
    private readonly filters: Array<(row: Row) => boolean> = []
    private patch: Row = {}
    private newRow: Row = {}
    private columns: string | null = null
    private returning = false
    private mode: Mode = 'many'
    private readonly name: string

    constructor(name: string) { this.name = name }

    select(columns?: string, options?: unknown) {
      if (options !== undefined) throw new Error('memoryDb: select options (count/head) unsupported')
      this.columns = columns ?? '*'
      if (this.op !== 'select') this.returning = true
      return this
    }
    // Requests are JSON on the wire, so undefined-valued keys never reach the
    // database (e.g. `{ note: undefined }` leaves the column as it was).
    insert(row: Row)   { this.op = 'insert'; this.newRow = defined(row); return this }
    update(patch: Row) { this.op = 'update'; this.patch = defined(patch); return this }

    eq(column: string, value: unknown) { this.filters.push(r => r[column] === value); return this }
    is(column: string, value: null) {
      if (value !== null) throw new Error('memoryDb: is() only supports null')
      this.filters.push(r => r[column] == null)
      return this
    }
    not(column: string, operator: string, value: null) {
      if (operator !== 'is' || value !== null) throw new Error('memoryDb: not() only supports (col, "is", null)')
      this.filters.push(r => r[column] != null)
      return this
    }
    single()      { this.mode = 'single';      return this }
    maybeSingle() { this.mode = 'maybeSingle'; return this }

    private project(row: Row): Row {
      const cols = this.columns
      if (!cols || cols === '*' || cols.includes('(')) return { ...row }
      return Object.fromEntries(cols.split(',').map(c => c.trim()).map(c => [c, row[c]]))
    }

    private shape(rows: Row[]): Result {
      if (this.mode === 'many') return { data: rows, error: null }
      if (rows.length > 1 || (this.mode === 'single' && rows.length === 0)) {
        return { data: null, error: err('JSON object requested, multiple (or no) rows returned', 'PGRST116') }
      }
      return { data: rows[0] ?? null, error: null }
    }

    private execute(): Result {
      ops.push({ op: this.op, table: this.name })
      const injected = failures.findIndex(f => f.op === this.op && f.table === this.name)
      if (injected >= 0) {
        const [failure] = failures.splice(injected, 1)
        return { data: null, error: err(failure.message) }
      }

      const rows = table(this.name)

      if (this.op === 'select') {
        return this.shape(rows.filter(r => this.filters.every(f => f(r))).map(r => this.project(r)))
      }

      if (this.op === 'insert') {
        const now = new Date().toISOString()
        const row: Row = { id: `${this.name}-${++seq}`, created_at: now, updated_at: now, ...this.newRow }
        const isOpen = (r: Row) => r.checked_in_at != null && r.checked_out_at == null
        if (this.name === 'attendance_records' && isOpen(row) &&
            rows.some(r => isOpen(r) && r.article_id === row.article_id)) {
          return { data: null, error: err('duplicate key value violates unique constraint "idx_attendance_one_open_session_per_article"', '23505') }
        }
        rows.push(row)
        return this.returning ? this.shape([this.project(row)]) : { data: null, error: null }
      }

      const matched = rows.filter(r => this.filters.every(f => f(r)))
      for (const row of matched) Object.assign(row, this.patch, { updated_at: new Date().toISOString() })
      return this.returning ? this.shape(matched.map(r => this.project(r))) : { data: null, error: null }
    }

    then<R1 = Result, R2 = never>(
      onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onrejected?:  ((reason: any) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected)
    }
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (name: string) => new Query(name),
  }

  return {
    client,
    tables,
    ops,
    /** Make the next matching operation fail once (op: 'select' | 'insert' | 'update'). */
    failNext: (op: 'select' | 'insert' | 'update', tableName: string, message = 'injected failure') =>
      void failures.push({ op, table: tableName, message }),
  }
}
