import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { paymentApi } from '@/api/cloud/payment'
import { modelsApi } from '@/api/cloud/models'
import { useBillingStore } from '@/stores/billingStore'
import { QRCodeSVG } from 'qrcode.react'
import type { PaymentPackage, OrderInfo, AiModel, BillingMode } from '@/types'

export default function PackagesPricing() {
  const { t } = useTranslation('packages')
  // ==================== 套餐相关状态 ====================
  const [packages, setPackages] = useState<PaymentPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Payment flow state
  const [selectedPkg, setSelectedPkg] = useState<PaymentPackage | null>(null)
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null)
  const [ordering, setOrdering] = useState(false)
  const [payResult, setPayResult] = useState<'success' | 'expired' | null>(null)
  const [countdown, setCountdown] = useState(0)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchBalance = useBillingStore((s) => s.fetchBalance)

  // ==================== 价格相关状态 ====================
  const [allModels, setAllModels] = useState<AiModel[]>([])
  const [priceLoading, setPriceLoading] = useState(true)

  // ==================== 数据加载 ====================

  // Load packages
  useEffect(() => {
    const load = async () => {
      try {
        const res = await paymentApi.getPackages()
        setPackages(res.data.data || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : t('error'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [t])

  // Load models for pricing
  useEffect(() => {
    const loadModels = async () => {
      try {
        const res = await modelsApi.getModels()
        setAllModels(res.data.data || [])
      } catch {
        setAllModels([])
      } finally {
        setPriceLoading(false)
      }
    }
    loadModels()
  }, [])

  const clearTimers = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => clearTimers, [clearTimers])

  // ==================== 支付相关函数 ====================

  const handleBuy = (pkg: PaymentPackage) => {
    setSelectedPkg(pkg)
    setPayResult(null)
  }

  const handleSelectPayment = async (method: number) => {
    if (!selectedPkg) return
    clearTimers()
    setOrdering(true)
    setError(null)
    try {
      const res = await paymentApi.createOrder({
        package_id: selectedPkg.package_id,
        payment_method: method,
      })
      const order = res.data.data
      setOrderInfo(order)
      setSelectedPkg(null)

      // Start countdown
      const expireTime = new Date(order.expire_time).getTime()
      const updateCountdown = () => {
        const remaining = Math.max(0, Math.floor((expireTime - Date.now()) / 1000))
        setCountdown(remaining)
        if (remaining <= 0) {
          clearTimers()
          setPayResult('expired')
        }
      }
      updateCountdown()
      countdownRef.current = setInterval(updateCountdown, 1000)

      // Start polling order status
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await paymentApi.getOrderStatus(order.order_no)
          const status = statusRes.data.data.status
          if (status === 2) {
            clearTimers()
            setPayResult('success')
            fetchBalance()
          } else if (status === 3 || status === 4) {
            clearTimers()
            setPayResult('expired')
          }
        } catch {
          // Ignore polling errors
        }
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('payment.creating'))
    } finally {
      setOrdering(false)
    }
  }

  const handleCloseOrder = () => {
    clearTimers()
    setOrderInfo(null)
    setPayResult(null)
    setCountdown(0)
  }

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="text-sm text-red-600 hover:text-red-800 ml-4">✕</button>
        </div>
      )}

      {/* ==================== 套餐部分 ==================== */}
      <div className="mb-8">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">{t('pricing.title')}</h2>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-500 text-sm">{t('loading')}</span>
          </div>
        ) : packages.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">{t('comingSoon')}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {packages.map((pkg) => (
              <div
                key={pkg.package_id}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 flex flex-col"
              >
                {pkg.discount > 1 && (
                  <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded mb-2 inline-block self-start">
                    {t('discount', { percent: Math.round((pkg.discount - 1) * 100) })}
                  </span>
                )}
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{pkg.name}</h3>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">¥{pkg.price}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('points', { count: pkg.points })}</p>
                <p className="text-xs text-gray-400 mt-1">{t('validity', { period: pkg.validity })}</p>
                <button
                  onClick={() => handleBuy(pkg)}
                  className="mt-4 w-full py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
                >
                  {t('buy')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ==================== 大模型价格部分 ==================== */}
      <PricingSection models={allModels} loading={priceLoading} />

      {/* ==================== 支付弹窗 ==================== */}

      {/* 支付方式选择弹窗 */}
      {selectedPkg && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-[360px] max-w-[90vw]">
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">{t('payment.selectMethod')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {selectedPkg.name} - ¥{selectedPkg.price}
            </p>
            <div className="space-y-2">
              <button
                onClick={() => handleSelectPayment(1)}
                disabled={ordering}
                className="w-full flex items-center justify-center gap-2 py-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                <span className="text-green-500 text-lg">&#9679;</span>
                <span className="text-sm text-gray-800 dark:text-gray-200">{t('payment.wechat')}</span>
              </button>
              <button
                onClick={() => handleSelectPayment(2)}
                disabled={ordering}
                className="w-full flex items-center justify-center gap-2 py-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                <span className="text-blue-500 text-lg">&#9679;</span>
                <span className="text-sm text-gray-800 dark:text-gray-200">{t('payment.alipay')}</span>
              </button>
            </div>
            {ordering && (
              <div className="flex items-center justify-center mt-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                <span className="ml-2 text-gray-500 text-xs">{t('payment.creating')}</span>
              </div>
            )}
            <button
              onClick={() => setSelectedPkg(null)}
              disabled={ordering}
              className="mt-4 w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* 二维码支付弹窗 */}
      {orderInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-[360px] max-w-[90vw] text-center">
            {payResult === 'success' ? (
              <>
                <div className="text-green-500 text-4xl mb-3">&#10003;</div>
                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">{t('payment.result.success')}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('payment.result.successDesc')}</p>
                <button
                  onClick={handleCloseOrder}
                  className="w-full py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
                >
                  {t('confirm')}
                </button>
              </>
            ) : payResult === 'expired' ? (
              <>
                <div className="text-gray-400 text-4xl mb-3">&#9201;</div>
                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">{t('payment.result.expired')}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('payment.result.expiredDesc')}</p>
                <button
                  onClick={handleCloseOrder}
                  className="w-full py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                >
                  {t('close')}
                </button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">{t('payment.qrcode.title')}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  {t('payment.qrcode.amount')}：<span className="font-medium text-gray-800 dark:text-gray-100">¥{orderInfo.amount}</span>
                </p>
                <div className="flex items-center justify-center mb-3">
                  <div className="p-3 bg-white rounded-lg border border-gray-200 dark:border-gray-600">
                    <QRCodeSVG
                      value={orderInfo.payment_url}
                      size={192}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400 mb-1">
                  {t('payment.qrcode.scanWith', { app: orderInfo.payment_method === 1 ? t('payment.wechat') : t('payment.alipay') })}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('payment.qrcode.remaining')}：<span className={`font-mono ${countdown < 60 ? 'text-red-500' : 'text-gray-800 dark:text-gray-200'}`}>
                    {formatCountdown(countdown)}
                  </span>
                </p>
                <div className="flex items-center justify-center mt-2 text-gray-400">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400"></div>
                  <span className="ml-1.5 text-xs">{t('payment.qrcode.waiting')}</span>
                </div>
                <button
                  onClick={handleCloseOrder}
                  className="mt-3 w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {t('payment.cancel')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== 价格展示子组件（按模型类型分 Tab） ====================

type PriceTab = 'llm' | 'image_gen' | 'video_gen'

function PricingSection({ models, loading }: { models: AiModel[]; loading: boolean }) {
  const { t } = useTranslation('packages')
  const [activeTab, setActiveTab] = useState<PriceTab>('llm')

  const tabConfig: { key: PriceTab; labelKey: string; billingModes: BillingMode[] }[] = [
    { key: 'llm', labelKey: 'pricing.tabs.llm', billingModes: ['token'] },
    { key: 'image_gen', labelKey: 'pricing.tabs.image_gen', billingModes: ['image'] },
    { key: 'video_gen', labelKey: 'pricing.tabs.video_gen', billingModes: ['token', 'dimension'] },
  ]

  // 按 model_type 分组
  const grouped = useMemo(() => {
    const result: Record<PriceTab, AiModel[]> = { llm: [], image_gen: [], video_gen: [] }
    for (const m of models) {
      const mt = (m.model_type || 'llm') as PriceTab
      if (result[mt]) {
        result[mt].push(m)
      } else {
        result.llm.push(m)
      }
    }
    return result
  }, [models])

  // 自动选择有数据的第一个 Tab
  useEffect(() => {
    if (grouped[activeTab].length === 0) {
      const firstNonEmpty = tabConfig.find(t => grouped[t.key].length > 0)
      if (firstNonEmpty) setActiveTab(firstNonEmpty.key)
    }
  }, [grouped, activeTab])

  const currentModels = grouped[activeTab]

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">{t('pricing.title')}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('pricing.subtitle')}</p>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          <span className="ml-3 text-gray-500 text-sm">{t('pricing.loading')}</span>
        </div>
      ) : models.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">{t('comingSoon')}</div>
      ) : (
        <>
          {/* Tab 切换 */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-0">
            {tabConfig.map(tab => {
              const count = grouped[tab.key].length
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                  }`}
                >
                  {t(tab.labelKey)}
                  {count > 0 && <span className="ml-1 text-xs text-gray-400">({count})</span>}
                </button>
              )
            })}
          </div>

          {/* Tab 内容 */}
          <div className="bg-white dark:bg-gray-800 rounded-b-lg border border-t-0 border-gray-200 dark:border-gray-700 overflow-hidden">
            {currentModels.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">{t('pricing.noModels')}</div>
            ) : activeTab === 'llm' || (activeTab === 'video_gen' && currentModels.every(m => (m.billing_mode || 'token') === 'token')) ? (
              /* 文本模型 + token 计费的视频模型 => token 阶梯表 */
              <TokenPriceTable models={currentModels} />
            ) : activeTab === 'image_gen' ? (
              /* 生图模型 => image 计费表 */
              <ImagePriceTable models={currentModels} />
            ) : (
              /* 视频模型（混合：部分 token、部分 dimension） */
              <div>
                {/* token 计费的视频模型 */}
                {currentModels.filter(m => (m.billing_mode || 'token') === 'token').length > 0 && (
                  <div>
                    <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                      {t('pricing.billingMode.token')}
                    </div>
                    <TokenPriceTable models={currentModels.filter(m => (m.billing_mode || 'token') === 'token')} />
                  </div>
                )}
                {/* dimension 计费的视频模型 */}
                {currentModels.filter(m => m.billing_mode === 'dimension').length > 0 && (
                  <div>
                    <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                      {t('pricing.billingMode.dimension')}
                    </div>
                    <DimensionPriceTable models={currentModels.filter(m => m.billing_mode === 'dimension')} />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Token 阶梯价格表 */
function TokenPriceTable({ models }: { models: AiModel[] }) {
  const { t } = useTranslation('packages')

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
          <th className="text-left px-4 py-3 font-medium">{t('pricing.table.modelName')}</th>
          <th className="text-center px-4 py-3 font-medium">{t('pricing.table.contextLength')}<br /><span className="text-xs font-normal text-gray-400">({t('pricing.table.contextLengthUnit')})</span></th>
          <th className="text-center px-4 py-3 font-medium">{t('pricing.table.inputPrice')}<br /><span className="text-xs font-normal text-gray-400">({t('pricing.table.priceUnit')})</span></th>
          <th className="text-center px-4 py-3 font-medium">{t('pricing.table.outputPrice')}<br /><span className="text-xs font-normal text-gray-400">({t('pricing.table.priceUnit')})</span></th>
          <th className="text-center px-4 py-3 font-medium">{t('pricing.table.cachedPrice')}<br /><span className="text-xs font-normal text-gray-400">({t('pricing.table.priceUnit')})</span></th>
          <th className="text-center px-4 py-3 font-medium">{t('pricing.table.cacheStorage')}<br /><span className="text-xs font-normal text-gray-400">({t('pricing.table.cacheStorageUnit')})</span></th>
        </tr>
      </thead>
      <tbody>
        {models.map((model) => {
          const tiers = model.price_tiers && model.price_tiers.length > 0 ? model.price_tiers : []
          if (tiers.length === 0) {
            return (
              <tr key={model.model_id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 text-gray-800 dark:text-gray-200 font-medium">
                  <div>{model.model_name}</div>
                  <div className="text-xs font-normal font-mono text-gray-400 dark:text-gray-500 mt-0.5">{model.model_id}</div>
                </td>
                <td className="px-4 py-3 text-center text-gray-400 text-xs" colSpan={5}>{t('pricing.noPrice')}</td>
              </tr>
            )
          }
          return tiers.map((tier, idx) => {
            const rangeStr = tier.max_context_length != null
              ? `${tier.min_context_length}K ~ ${tier.max_context_length}K`
              : `${tier.min_context_length}K+`
            return (
              <tr key={`${model.model_id}-${idx}`} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                {idx === 0 && (
                  <td className="px-4 py-3 text-gray-800 dark:text-gray-200 font-medium" rowSpan={tiers.length}>
                    <div>{model.model_name}</div>
                    <div className="text-xs font-normal font-mono text-gray-400 dark:text-gray-500 mt-0.5">{model.model_id}</div>
                  </td>
                )}
                <td className="px-4 py-2 text-center text-xs font-mono text-gray-600 dark:text-gray-400">{rangeStr}</td>
                <td className="px-4 py-2 text-center text-xs">{tier.sale_input_price}</td>
                <td className="px-4 py-2 text-center text-xs">{tier.sale_output_price}</td>
                <td className="px-4 py-2 text-center text-xs text-gray-500">{tier.sale_cached_input_price ?? '-'}</td>
                <td className="px-4 py-2 text-center text-xs text-gray-500">{tier.sale_cache_storage_price ?? '-'}</td>
              </tr>
            )
          })
        })}
      </tbody>
    </table>
  )
}

/** 生图价格表（image 计费模式） */
function ImagePriceTable({ models }: { models: AiModel[] }) {
  const { t } = useTranslation('packages')

  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-700">
      {models.map((model) => {
        const prices = model.image_prices || []
        return (
          <div key={model.model_id} className="p-4">
            <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">{model.model_name}</h4>
            <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mb-3">{model.model_id}</p>
            {prices.length === 0 ? (
              <p className="text-xs text-gray-400">{t('pricing.noPrice')}</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 dark:text-gray-400">
                    <th className="text-left py-1.5 px-2 font-medium">{t('pricing.imageTable.resolution')}</th>
                    <th className="text-center py-1.5 px-2 font-medium">{t('pricing.imageTable.pricePerImage')}</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map((price, idx) => (
                    <tr key={idx} className="border-t border-gray-100 dark:border-gray-700/50">
                      <td className="py-1.5 px-2 font-mono text-gray-700 dark:text-gray-300">
                        {price.resolution || t('pricing.imageTable.anyResolution')}
                      </td>
                      <td className="py-1.5 px-2 text-center font-medium text-purple-600 dark:text-purple-400">
                        {price.sale_price}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 多维度价格表（生视频模型） */
function DimensionPriceTable({ models }: { models: AiModel[] }) {
  const { t } = useTranslation('packages')

  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-700">
      {models.map((model) => {
        const prices = model.dimension_prices || []
        // 按分辨率分组
        const byResolution = prices.reduce((acc, p) => {
          if (!acc[p.resolution]) acc[p.resolution] = []
          acc[p.resolution].push(p)
          return acc
        }, {} as Record<string, typeof prices>)

        return (
          <div key={model.model_id} className="p-4">
            <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">{model.model_name}</h4>
            <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mb-3">{model.model_id}</p>
            {prices.length === 0 ? (
              <p className="text-xs text-gray-400">{t('pricing.noPrice')}</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 dark:text-gray-400">
                    <th className="text-left py-1.5 px-2 font-medium">{t('pricing.videoTable.resolution')}</th>
                    <th className="text-center py-1.5 px-2 font-medium">{t('pricing.videoTable.maxDuration')}</th>
                    <th className="text-center py-1.5 px-2 font-medium">{t('pricing.videoTable.audio')}</th>
                    <th className="text-center py-1.5 px-2 font-medium">{t('pricing.videoTable.customVoice')}</th>
                    <th className="text-center py-1.5 px-2 font-medium">{t('pricing.videoTable.pricePerSecond')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byResolution).map(([resolution, items]) =>
                    items.map((item, idx) => (
                      <tr key={`${resolution}-${idx}`} className="border-t border-gray-100 dark:border-gray-700/50">
                        {idx === 0 && (
                          <td className="py-1.5 px-2 font-mono text-gray-700 dark:text-gray-300" rowSpan={items.length}>{resolution}</td>
                        )}
                        <td className="py-1.5 px-2 text-center text-gray-600 dark:text-gray-400">{item.max_duration_seconds}s</td>
                        <td className="py-1.5 px-2 text-center">{item.has_audio ? '✓' : '✗'}</td>
                        <td className="py-1.5 px-2 text-center">{item.custom_voice ? '✓' : '✗'}</td>
                        <td className="py-1.5 px-2 text-center font-medium text-orange-600 dark:text-orange-400">{item.sale_price}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
