'use client'

import React, { useState } from 'react'
import { UserCheck, X } from 'lucide-react'
import { useEscapeToClose } from '@/hooks/useEscapeToClose'
import { capitalizeFirst } from '@/lib/utils'

interface OperatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (operatorName: string) => void;
  isLoading: boolean;
}

export function OperatorModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
}: OperatorModalProps) {
  const [operatorName, setOperatorName] = useState('')

  useEscapeToClose(isOpen, onClose)

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!operatorName.trim()) return
    onConfirm(operatorName.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-neutral-900/90 border border-neutral-800 rounded-2xl p-6 shadow-2xl text-neutral-100 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-200 transition-colors"
          disabled={isLoading}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-500/30 text-red-400">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Operator Authorization</h3>
            <p className="text-xs text-neutral-400">
              Confirm operator identity to execute system backup
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-1.5">
              Operator Full Name / ID
            </label>
            <input
              type="text"
              required
              placeholder="e.g. John Doe (OP-904)"
              value={operatorName}
              onChange={(e) => setOperatorName(capitalizeFirst(e.target.value))}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-neutral-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !operatorName.trim()}
              className="px-5 py-2.5 text-xs font-bold bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl shadow-lg transition-colors flex items-center gap-2"
            >
              {isLoading ? 'Processing...' : 'Authorize & Export'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
