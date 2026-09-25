import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShift } from '../auth/ShiftContext'

/**
 * Выбор режима смены после входа (ТЗ §5.1): магазин — обычная работа;
 * ярмарка — то же самое плюс название, которое проставляется всем продажам
 * смены. Каталог в обоих режимах общий: на ярмарку берут все работы.
 */
export default function ShiftModePage() {
  const { mode, fairName, setStoreMode, setFairMode } = useShift()
  const navigate = useNavigate()

  const [step, setStep] = useState<'choose' | 'fair'>('choose')
  const [name, setName] = useState(fairName ?? '')

  function chooseStore() {
    setStoreMode()
    navigate('/', { replace: true })
  }

  function confirmFair() {
    if (!name.trim()) return
    setFairMode(name.trim())
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-white text-xl font-bold text-center mb-2">Режим смены</h1>
        {mode && (
          <p className="text-gray-300 text-sm text-center">
            Сейчас: {mode === 'fair' ? `Ярмарка «${fairName}»` : 'Магазин'}
          </p>
        )}

        {step === 'choose' ? (
          <>
            <button
              onClick={chooseStore}
              className="w-full bg-white rounded-2xl p-6 text-left shadow-xl active:scale-[0.99]"
            >
              <div className="text-3xl">🏬</div>
              <div className="text-lg font-bold mt-2">Магазин</div>
              <div className="text-sm text-gray-500">
                Тип покупателя выбирается при каждой продаже
              </div>
            </button>
            <button
              onClick={() => setStep('fair')}
              className="w-full bg-amber-400 rounded-2xl p-6 text-left shadow-xl active:scale-[0.99]"
            >
              <div className="text-3xl">🎪</div>
              <div className="text-lg font-bold mt-2">Ярмарка</div>
              <div className="text-sm text-amber-900">
                Все продажи смены получат тип «Ярмарка» и её название
              </div>
            </button>
          </>
        ) : (
          <div className="bg-white rounded-2xl p-5 shadow-xl">
            <div className="flex items-center gap-2">
              <button onClick={() => setStep('choose')} className="text-2xl leading-none px-1">
                ‹
              </button>
              <div className="font-bold text-lg">Ярмарочная смена</div>
            </div>
            <label className="block text-sm font-medium text-gray-700 mt-3">
              Название ярмарки
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmFair()}
                placeholder="например: Маркет на Никольской"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-gray-900"
                autoFocus
              />
            </label>
            <button
              onClick={confirmFair}
              disabled={!name.trim()}
              className="mt-4 w-full bg-gray-900 text-white rounded-xl py-3.5 font-semibold disabled:opacity-40"
            >
              Начать смену «{name.trim() || '…'}»
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
