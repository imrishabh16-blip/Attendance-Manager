import { cn } from '@/lib/utils'

interface TableProps {
  children: React.ReactNode
  className?: string
}

export function Table({ children, className }: TableProps) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-brand-200">
      <table className={cn('w-full text-sm', className)}>
        {children}
      </table>
    </div>
  )
}

export function Thead({ children }: TableProps) {
  return (
    <thead className="bg-brand-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
      {children}
    </thead>
  )
}

export function Tbody({ children }: TableProps) {
  return <tbody className="divide-y divide-gray-50">{children}</tbody>
}

export function Th({ children, className }: TableProps) {
  return <th className={cn('px-4 py-3 text-left', className)}>{children}</th>
}

export function Td({ children, className }: TableProps) {
  return <td className={cn('px-4 py-3 text-gray-700', className)}>{children}</td>
}
