'use client'

import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const [keyboardInset, setKeyboardInset] = useState(0)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Lift the panel above the software keyboard on mobile.
  // visualViewport tracks the visible area; when the keyboard opens its
  // height shrinks. marginBottom equal to the difference pushes the panel
  // up so results remain visible without dismissing the keyboard.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return
    const update = () =>
      setKeyboardInset(Math.max(0, window.innerHeight - vv.offsetTop - vv.height))
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setKeyboardInset(0)
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={cn(
          'relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl',
          'flex flex-col max-h-[90dvh]',
          className
        )}
        style={keyboardInset > 0 ? { marginBottom: keyboardInset } : undefined}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-brand-200 shrink-0">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>
      </div>
    </div>
  )
}
