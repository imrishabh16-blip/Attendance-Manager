import ExcelJS from 'exceljs'

export interface StatusReportRow {
  article_name: string
  status:       'Checked In' | 'Completed' | 'On Leave' | 'AWOL'
  client:       string
  work_type:    string
  check_in:     string
  check_out:    string
  duration:     string
}

export interface AttendanceExportRow {
  article_name: string
  assignment_label: string
  work_type_label: string
  attendance_date: string
  checked_in_at: string | null
  checked_out_at: string | null
  duration_hours: number | null
  check_in_lat: number | null
  check_in_lng: number | null
  check_out_lat: number | null
  check_out_lng: number | null
  maps_link_in: string | null
  maps_link_out: string | null
  note: string | null
  attendance_type_label: string
  others_client_name: string | null
  regularized: boolean
  status: string
}


export interface SessionReportRow {
  assignment_label: string
  client_name:      string
  work_type:        string
  session_number:   string
  articles_count:   number
  article_names:    string
  attendance_days:  number
  total_hours:      number
  status:           'Active' | 'Completed'
  first_date:       string
  last_date:        string
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD6E4F0' },
}

function applyHeaderStyle(row: ExcelJS.Row) {
  row.font = { bold: true, size: 11 }
  row.fill = HEADER_FILL
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
  row.height = 22
}

const ATTENDANCE_STATUS_COLORS: Record<string, string> = {
  'Completed':   'FF15803D',
  'Half Day':    'FFD97706',
  'Unallocated': 'FF6B7280',
  'On Leave':    'FFB45309',
  'AWOL':        'FFB91C1C',
}

export async function buildAttendanceExcel(rows: AttendanceExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CA Attendance Manager'
  wb.created = new Date()

  const ws = wb.addWorksheet('Attendance Report', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  ws.columns = [
    { header: 'Article Name',   key: 'article_name',       width: 22 },
    { header: 'Assignment',     key: 'assignment_label',   width: 36 },
    { header: 'Work Type',      key: 'work_type_label',    width: 26 },
    { header: 'Date',           key: 'attendance_date',    width: 14 },
    { header: 'Check-In',       key: 'checked_in_at',      width: 20 },
    { header: 'Check-Out',      key: 'checked_out_at',     width: 20 },
    { header: 'Hours',          key: 'duration_hours',     width: 10 },
    { header: 'Status',         key: 'status',             width: 14 },
    { header: 'Check-In Map',   key: 'maps_link_in',       width: 18 },
    { header: 'Check-Out Map',  key: 'maps_link_out',      width: 18 },
    { header: 'Notes',          key: 'note',               width: 32 },
    { header: 'Type',           key: 'attendance_type',    width: 12 },
    { header: 'Others Client',  key: 'others_client_name', width: 22 },
    { header: 'Regularized',    key: 'regularized',        width: 12 },
  ]

  applyHeaderStyle(ws.getRow(1))

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN') : ''
  const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : ''

  for (const row of rows) {
    const r = ws.addRow({
      article_name:        row.article_name,
      assignment_label:    row.assignment_label,
      work_type_label:     row.work_type_label,
      attendance_date:     fmtDate(row.attendance_date),
      checked_in_at:       fmtTime(row.checked_in_at),
      checked_out_at:      fmtTime(row.checked_out_at),
      duration_hours:      row.duration_hours ?? '',
      status:              row.status,
      maps_link_in:        '',
      maps_link_out:       '',
      note:                row.note ?? '',
      attendance_type:     row.attendance_type_label,
      others_client_name:  row.others_client_name ?? '',
      regularized:         row.regularized ? 'Yes' : 'No',
    })

    if (row.status) {
      const color = ATTENDANCE_STATUS_COLORS[row.status]
      if (color) r.getCell('status').font = { bold: true, color: { argb: color } }
    }
    if (row.maps_link_in) {
      r.getCell('maps_link_in').value = { text: 'View Map', hyperlink: row.maps_link_in }
      r.getCell('maps_link_in').font = { color: { argb: 'FF0563C1' }, underline: true }
    }
    if (row.maps_link_out) {
      r.getCell('maps_link_out').value = { text: 'View Map', hyperlink: row.maps_link_out }
      r.getCell('maps_link_out').font = { color: { argb: 'FF0563C1' }, underline: true }
    }
    if (row.regularized) {
      r.getCell('regularized').font = { color: { argb: 'FFCA8A04' } }
    }
  }

  ws.autoFilter = { from: 'A1', to: 'N1' }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

const STATUS_COLORS: Record<string, string> = {
  'Checked In': 'FF15803D',
  'Completed':  'FF1D4ED8',
  'On Leave':   'FFB45309',
  'AWOL':       'FFB91C1C',
}

export async function buildStatusReportExcel(rows: StatusReportRow[], date: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CA Attendance Manager'
  wb.created = new Date()

  const ws = wb.addWorksheet('Status Report', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  ws.columns = [
    { header: 'Article',    key: 'article_name', width: 24 },
    { header: 'Status',     key: 'status',       width: 14 },
    { header: 'Client',     key: 'client',       width: 32 },
    { header: 'Work Type',  key: 'work_type',    width: 26 },
    { header: 'Check In',   key: 'check_in',     width: 14 },
    { header: 'Check Out',  key: 'check_out',    width: 14 },
    { header: 'Duration',   key: 'duration',     width: 12 },
  ]

  applyHeaderStyle(ws.getRow(1))

  // Title in A1 cell tooltip area — use sheet properties instead
  ws.headerFooter.oddHeader = `&C&B Status Report — ${date}`

  for (const row of rows) {
    const r = ws.addRow({
      article_name: row.article_name,
      status:       row.status,
      client:       row.client,
      work_type:    row.work_type,
      check_in:     row.check_in,
      check_out:    row.check_out,
      duration:     row.duration,
    })
    const color = STATUS_COLORS[row.status]
    if (color) {
      r.getCell('status').font = { bold: true, color: { argb: color } }
    }
  }

  ws.autoFilter = { from: 'A1', to: 'G1' }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

const SESSION_STATUS_COLORS: Record<string, string> = {
  'Active':    'FF15803D',
  'Completed': 'FF1D4ED8',
}

export async function buildSessionReportExcel(rows: SessionReportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CA Attendance Manager'
  wb.created = new Date()

  const ws = wb.addWorksheet('Session Report', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  ws.columns = [
    { header: 'Assignment',       key: 'assignment_label', width: 34 },
    { header: 'Client Name',      key: 'client_name',      width: 26 },
    { header: 'Work Type',        key: 'work_type',        width: 24 },
    { header: 'Session',          key: 'session_number',   width: 10 },
    { header: 'Articles',         key: 'articles_count',   width: 12 },
    { header: 'Article Names',    key: 'article_names',    width: 36 },
    { header: 'Days',             key: 'attendance_days',  width: 10 },
    { header: 'Hours',            key: 'total_hours',      width: 10 },
    { header: 'Status',           key: 'status',           width: 12 },
    { header: 'First Attendance', key: 'first_date',       width: 16 },
    { header: 'Last Attendance',  key: 'last_date',        width: 16 },
  ]

  applyHeaderStyle(ws.getRow(1))

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN')

  for (const row of rows) {
    const r = ws.addRow({
      assignment_label: row.assignment_label,
      client_name:      row.client_name,
      work_type:        row.work_type,
      session_number:   row.session_number,
      articles_count:   row.articles_count,
      article_names:    row.article_names,
      attendance_days:  row.attendance_days,
      total_hours:      row.total_hours,
      status:           row.status,
      first_date:       fmtDate(row.first_date),
      last_date:        fmtDate(row.last_date),
    })
    const color = SESSION_STATUS_COLORS[row.status]
    if (color) r.getCell('status').font = { bold: true, color: { argb: color } }
  }

  ws.autoFilter = { from: 'A1', to: 'K1' }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

