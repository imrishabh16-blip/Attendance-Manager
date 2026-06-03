import ExcelJS from 'exceljs'

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
}

export interface AssignmentExportRow {
  client_name: string
  work_type_label: string
  total_days: number
  total_hours: number
  articles_involved: number
  first_attendance: string | null
  last_attendance: string | null
  assignment_status: string
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

export async function buildAttendanceExcel(rows: AttendanceExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CA Attendance Manager'
  wb.created = new Date()

  const ws = wb.addWorksheet('Attendance Report', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  ws.columns = [
    { header: 'Article Name',        key: 'article_name',       width: 22 },
    { header: 'Assignment',           key: 'assignment_label',   width: 36 },
    { header: 'Work Type',            key: 'work_type_label',    width: 26 },
    { header: 'Date',                 key: 'attendance_date',    width: 14 },
    { header: 'Check-In',             key: 'checked_in_at',      width: 20 },
    { header: 'Check-Out',            key: 'checked_out_at',     width: 20 },
    { header: 'Hours',                key: 'duration_hours',     width: 10 },
    { header: 'Check-In Lat',         key: 'check_in_lat',       width: 14 },
    { header: 'Check-In Lng',         key: 'check_in_lng',       width: 14 },
    { header: 'Check-Out Lat',        key: 'check_out_lat',      width: 14 },
    { header: 'Check-Out Lng',        key: 'check_out_lng',      width: 14 },
    { header: 'Check-In Map',         key: 'maps_link_in',       width: 18 },
    { header: 'Check-Out Map',        key: 'maps_link_out',      width: 18 },
    { header: 'Notes',                key: 'note',               width: 32 },
    { header: 'Type',                 key: 'attendance_type',    width: 12 },
    { header: 'Others Client',        key: 'others_client_name', width: 22 },
    { header: 'Regularized',          key: 'regularized',        width: 12 },
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
      check_in_lat:        row.check_in_lat ?? '',
      check_in_lng:        row.check_in_lng ?? '',
      check_out_lat:       row.check_out_lat ?? '',
      check_out_lng:       row.check_out_lng ?? '',
      maps_link_in:        '',
      maps_link_out:       '',
      note:                row.note ?? '',
      attendance_type:     row.attendance_type_label,
      others_client_name:  row.others_client_name ?? '',
      regularized:         row.regularized ? 'Yes' : 'No',
    })

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

  ws.autoFilter = { from: 'A1', to: 'Q1' }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export async function buildAssignmentActivityExcel(rows: AssignmentExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CA Attendance Manager'
  wb.created = new Date()

  const ws = wb.addWorksheet('Assignment Activity', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  ws.columns = [
    { header: 'Client Name',        key: 'client_name',       width: 28 },
    { header: 'Work Type',          key: 'work_type_label',   width: 26 },
    { header: 'Attendance Days',    key: 'total_days',        width: 16 },
    { header: 'Total Hours',        key: 'total_hours',       width: 14 },
    { header: 'Articles Involved',  key: 'articles_involved', width: 18 },
    { header: 'First Attendance',   key: 'first_attendance',  width: 18 },
    { header: 'Last Attendance',    key: 'last_attendance',   width: 18 },
    { header: 'Status',             key: 'assignment_status', width: 12 },
  ]

  applyHeaderStyle(ws.getRow(1))

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN') : ''

  for (const row of rows) {
    ws.addRow({
      client_name:       row.client_name,
      work_type_label:   row.work_type_label,
      total_days:        row.total_days,
      total_hours:       row.total_hours,
      articles_involved: row.articles_involved,
      first_attendance:  fmtDate(row.first_attendance),
      last_attendance:   fmtDate(row.last_attendance),
      assignment_status: row.assignment_status.charAt(0).toUpperCase() + row.assignment_status.slice(1),
    })
  }

  ws.autoFilter = { from: 'A1', to: 'H1' }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
