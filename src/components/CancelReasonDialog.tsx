import { useState } from 'react'

/**
 * Шторка подтверждения отмены чека. Причина обязательна — руководитель
 * видит её в отчёте по отменённым продажам (пишется в sales.cancel_reason).
 */
export default function CancelReasonDialog({
  saleLabel,
  busy,
  onConfirm,
  onClose,
}: {
  saleLabel: string
  busy: boolean
  onConfirm: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl p-4 pb-6 max-w-3xl mx-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-300 rounded mx-auto mb-3" />
        <div className="font-semibold text-lg">Отменить чек?</div>
        <div className="text-sm text-gray-500 mt-0.5">{saleLabel}</div>

        <label className="block text-sm font-medium text-gray-700 mt-3">
          Причина отмены *
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="например: пробили по ошибке"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-900"
            autoFocus
          />
        </label>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-3 rounded-xl border border-gray-300 text-sm font-medium disabled:opacity-50"
          >
            Не отменять
          </button>
          <button
            onClick={() => onConfirm(reason.trim())}
            disabled={busy || !reason.trim()}
            className="flex-1 py-3 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Отмена…' : 'Отменить чек'}
          </button>
        </div>
      </div>
    </div>
  )
}
