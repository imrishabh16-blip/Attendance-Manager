import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import ExcelJS from 'exceljs'

// ── GET /api/clients/import ──────────────────────────────────────────────────
// Returns a downloadable XLSX template with a single "Client Name" column.
// No auth required — the template contains no data.
export async function GET() {
  const workbook = new ExcelJS.Workbook()
  const sheet    = workbook.addWorksheet('Clients')

  sheet.columns = [{ header: 'Client Name', key: 'name', width: 32 }]
  sheet.getRow(1).font = { bold: true }

  const buffer = await workbook.xlsx.writeBuffer()

  return new NextResponse(buffer, {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="client_import_template.xlsx"',
    },
  })
}

// ── POST /api/clients/import ─────────────────────────────────────────────────
// Accepts multipart/form-data with a single "file" field (.csv or .xlsx).
// Parses the file, trims whitespace, drops blank rows, and deduplicates within
// the file (case-insensitive). Returns { names: string[] }.
// DB writes are intentionally NOT done here — the client handles inserts so
// that RLS is applied through the user's own session.
export async function POST(request: NextRequest) {
  // Auth — must be an active admin, partner, or manager
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!['admin', 'partner', 'manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Parse form data
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!['csv', 'xlsx', 'xls'].includes(ext)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Please upload a .csv or .xlsx file.' },
      { status: 400 }
    )
  }

  // ── Parse ──────────────────────────────────────────────────────────────────
  let rawNames: string[] = []

  if (ext === 'csv') {
    const text = await file.text()
    const rows = text.split(/\r?\n/)
    // Skip the header row (row index 0)
    for (const row of rows.slice(1)) {
      const name = row.trim().replace(/^["']|["']$/g, '') // strip surrounding quotes
      if (name) rawNames.push(name)
    }
  } else {
    // xlsx / xls
    const buffer = await file.arrayBuffer()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)

    const sheet = workbook.worksheets[0]
    if (!sheet) {
      return NextResponse.json({ error: 'The spreadsheet appears to be empty.' }, { status: 400 })
    }

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return // skip header
      const cell  = row.getCell(1)
      // cell.text coerces all cell types (string, formula result, etc.) to string
      const value = (cell.text ?? '').toString().trim()
      if (value) rawNames.push(value)
    })
  }

  if (rawNames.length === 0) {
    return NextResponse.json(
      { error: 'No client names found in the file. Make sure rows start on row 2 (below the header).' },
      { status: 400 }
    )
  }

  // Trim whitespace and deduplicate within the file (case-insensitive, keep first occurrence)
  const seen  = new Set<string>()
  const names = rawNames
    .map(n => n.trim())
    .filter(n => {
      if (!n) return false
      const key = n.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return NextResponse.json({ names })
}
