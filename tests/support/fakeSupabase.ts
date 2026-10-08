// In-memory stand-in for the slice of the Supabase/PostgREST client that the
// Client Engagement route uses, so the route's real query chain (date bounds,
// the assignments!inner join, ordering, pagination) runs against test rows.
//
// It deliberately supports ONLY the calls the route makes today and throws on
// anything else, so a changed query fails loudly instead of being ignored.
// It models PostgREST semantics; it is not a database, so the real
// `assignments!inner` join and SQL filtering are not exercised against Postgres.

export interface FakeAttendanceRow {
  id:              string
  article_id:      string
  attendance_date: string
  checked_in_at:   string | null
  checked_out_at:  string | null
  profiles:        { full_name: string } | null
  // null = Others / unallocated punch (no assignment, no validated client)
  assignments:     { client_name: string } | null
}

type QueryResult = { data: FakeAttendanceRow[]; error: null }

class AttendanceQuery implements PromiseLike<QueryResult> {
  private readonly filters: Array<(row: FakeAttendanceRow) => boolean> = []
  private readonly sorts:   Array<{ column: keyof FakeAttendanceRow; ascending: boolean }> = []
  private window: [number, number] | null = null
  private readonly rows:       FakeAttendanceRow[]
  private readonly selectList: string
  private readonly calls:      string[]

  // Explicit fields rather than constructor parameter properties: Node runs
  // these tests with type-stripping only, which rejects that TS syntax.
  constructor(rows: FakeAttendanceRow[], selectList: string, calls: string[]) {
    this.rows       = rows
    this.selectList = selectList
    this.calls      = calls
    calls.push(`select:${selectList}`)
  }

  private cell(row: FakeAttendanceRow, column: string) {
    return row[column as keyof FakeAttendanceRow]
  }

  gte(column: string, value: string) {
    this.calls.push(`gte:${column}:${value}`)
    // SQL: NULL >= x is never true
    this.filters.push(row => {
      const v = this.cell(row, column)
      return typeof v === 'string' && v >= value
    })
    return this
  }

  lte(column: string, value: string) {
    this.calls.push(`lte:${column}:${value}`)
    this.filters.push(row => {
      const v = this.cell(row, column)
      return typeof v === 'string' && v <= value
    })
    return this
  }

  not(column: string, operator: string, value: unknown) {
    if (operator !== 'is' || value !== null) {
      throw new Error(`fakeSupabase: unsupported not(${column}, ${operator}, ${String(value)})`)
    }
    this.calls.push(`not:${column}:is:null`)
    this.filters.push(row => this.cell(row, column) !== null)
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.calls.push(`order:${column}`)
    this.sorts.push({ column: column as keyof FakeAttendanceRow, ascending: options?.ascending ?? true })
    return this
  }

  range(from: number, to: number) {
    this.calls.push(`range:${from}-${to}`)
    this.window = [from, to]
    return this
  }

  private execute(): QueryResult {
    // !inner makes PostgREST drop parent rows whose embedded row is missing.
    const innerJoinsAssignments = this.selectList.includes('assignments!inner')

    let result = this.rows.filter(row =>
      (!innerJoinsAssignments || row.assignments !== null) &&
      this.filters.every(keep => keep(row))
    )

    result = [...result].sort((a, b) => {
      for (const { column, ascending } of this.sorts) {
        const av = String(a[column])
        const bv = String(b[column])
        if (av !== bv) return (av < bv ? -1 : 1) * (ascending ? 1 : -1)
      }
      return 0
    })

    if (this.window) result = result.slice(this.window[0], this.window[1] + 1)
    return { data: result, error: null }
  }

  then<R1 = QueryResult, R2 = never>(
    onfulfilled?: ((value: QueryResult) => R1 | PromiseLike<R1>) | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onrejected?:  ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected)
  }
}

export function createFakeSupabase(options: {
  rows:    FakeAttendanceRow[]
  role?:   string
  status?: string
}) {
  const calls: string[] = []

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'viewer-1' } } }),
    },
    from(table: string) {
      if (table === 'profiles') {
        // profiles lookup for the viewer: .select().eq().single()
        const chain = {
          select: () => chain,
          eq:     () => chain,
          single: async () => ({
            data: { role: options.role ?? 'admin', status: options.status ?? 'active' },
          }),
        }
        return chain
      }
      if (table === 'attendance_records') {
        return {
          select: (selectList: string) => new AttendanceQuery(options.rows, selectList, calls),
        }
      }
      throw new Error(`fakeSupabase: unexpected table "${table}"`)
    },
  }

  return { client, calls }
}
