import { cn } from '@/lib/utils'

interface CardProps {
  className?: string
  children: React.ReactNode
}

export function Card({ className, children }: CardProps) {
  return (
    <div className={cn('bg-white rounded-2xl shadow-sm border border-brand-200', className)}>
      {children}
    </div>
  )
}

export function CardHeader({ className, children }: CardProps) {
  return (
    <div className={cn('px-5 py-4 border-b border-brand-200', className)}>
      {children}
    </div>
  )
}

export function CardBody({ className, children }: CardProps) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>
}
