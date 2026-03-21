import { useState, useEffect, useRef, useCallback } from 'react'
import { paymentApi } from '@/api/cloud/payment'
import { useBillingStore } from '@/stores/billingStore'
import { getServerBaseUrlSync } from '@/utils/server-url'
import type { PaymentPackage, OrderInfo } from '@/types'

export default function Packages() {
  const [packages, setPackages] = useState<PaymentPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Payment flow state
  const [selectedPkg, setSelectedPkg] = useState<PaymentPackage | null>(null)
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null)
  const [ordering, setOrdering] = useState(false)
  const [payResult, setPayResult] = useState<'success' | 'expired' | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [claimedPaid, setClaimedPaid] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchBalance = useBillingStore((s) => s.fetchBalance)

  // Load packages
  useEffect(() => {
    const load = async () => {
      try {
        const res = await paymentApi.getPackages()
        setPackages(res.data.data || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取套餐列表失败')
      } finally {
        setLoading(false)
      }
    }
    load()
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
            // Paid
            clearTimers()
            setPayResult('success')
            fetchBalance()
          } else if (status === 3 || status === 4) {
            // Cancelled or Refunded
            clearTimers()
            setPayResult('expired')
          }
        } catch {
          // Ignore polling errors
        }
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建订单失败')
    } finally {
      setOrdering(false)
    }
  }

  const handleCloseOrder = () => {
    clearTimers()
    setOrderInfo(null)
    setPayResult(null)
    setCountdown(0)
    setClaimedPaid(false)
  }

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">积分商店</h1>
        <p className="text-sm text-gray-500 mb-6">选择适合您的积分套餐，用于 AI 大模型调用</p>
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-500 text-sm">加载套餐...</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-2">积分商店</h1>
      <p className="text-sm text-gray-500 mb-6">选择适合您的积分套餐，用于 AI 大模型调用</p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="text-sm text-red-600 hover:text-red-800 ml-4">✕</button>
        </div>
      )}

      {/* 套餐卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {packages.map((pkg) => (
          <div
            key={pkg.package_id}
            className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col"
          >
            {pkg.discount > 1 && (
              <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded mb-2 inline-block self-start">
                赠送 {Math.round((pkg.discount - 1) * 100)}%
              </span>
            )}
            <h3 className="text-lg font-semibold text-gray-800">{pkg.name}</h3>
            <p className="text-2xl font-bold text-gray-900 mt-2">¥{pkg.price}</p>
            <p className="text-sm text-gray-500 mt-1">{pkg.points.toLocaleString()} 积分</p>
            <p className="text-xs text-gray-400 mt-1">有效期：{pkg.validity}</p>
            <button
              onClick={() => handleBuy(pkg)}
              className="mt-4 w-full py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
            >
              购买
            </button>
          </div>
        ))}
      </div>

      {/* 支付方式选择弹窗 */}
      {selectedPkg && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[360px] max-w-[90vw]">
            <h3 className="text-base font-semibold text-gray-800 mb-1">选择支付方式</h3>
            <p className="text-sm text-gray-500 mb-4">
              {selectedPkg.name} - ¥{selectedPkg.price}
            </p>
            <div className="space-y-2">
              <button
                onClick={() => handleSelectPayment(1)}
                disabled={ordering}
                className="w-full flex items-center justify-center gap-2 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <span className="text-green-500 text-lg">&#9679;</span>
                <span className="text-sm text-gray-800">微信支付</span>
              </button>
              <button
                onClick={() => handleSelectPayment(2)}
                disabled={ordering}
                className="w-full flex items-center justify-center gap-2 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <span className="text-blue-500 text-lg">&#9679;</span>
                <span className="text-sm text-gray-800">支付宝</span>
              </button>
            </div>
            {ordering && (
              <div className="flex items-center justify-center mt-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                <span className="ml-2 text-gray-500 text-xs">创建订单中...</span>
              </div>
            )}
            <button
              onClick={() => setSelectedPkg(null)}
              disabled={ordering}
              className="mt-4 w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 二维码支付弹窗 */}
      {orderInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[360px] max-w-[90vw] text-center">
            {payResult === 'success' ? (
              <>
                <div className="text-green-500 text-4xl mb-3">&#10003;</div>
                <h3 className="text-base font-semibold text-gray-800 mb-1">支付成功</h3>
                <p className="text-sm text-gray-500 mb-4">积分已到账，可前往消费统计查看。</p>
                <button
                  onClick={handleCloseOrder}
                  className="w-full py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
                >
                  确定
                </button>
              </>
            ) : payResult === 'expired' ? (
              <>
                <div className="text-gray-400 text-4xl mb-3">&#9201;</div>
                <h3 className="text-base font-semibold text-gray-800 mb-1">订单已过期</h3>
                <p className="text-sm text-gray-500 mb-4">支付超时，请重新下单。</p>
                <button
                  onClick={handleCloseOrder}
                  className="w-full py-2 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300 transition-colors"
                >
                  关闭
                </button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-gray-800 mb-1">扫码支付</h3>
                <p className="text-sm text-gray-500 mb-3">
                  支付金额：<span className="font-medium text-gray-800">¥{orderInfo.amount}</span>
                </p>
                <div className="flex items-center justify-center mb-3">
                  <img
                    src={orderInfo.qrcode_url.startsWith('/') ? `${getServerBaseUrlSync()}${orderInfo.qrcode_url}` : orderInfo.qrcode_url}
                    alt="支付二维码"
                    className="w-48 h-48 border border-gray-200 rounded"
                  />
                </div>
                <p className="text-xs text-gray-400 mb-1">请使用支付宝扫码支付</p>
                <p className="text-sm text-gray-600">
                  剩余时间：<span className={`font-mono ${countdown < 60 ? 'text-red-500' : 'text-gray-800'}`}>
                    {formatCountdown(countdown)}
                  </span>
                </p>
                {claimedPaid ? (
                  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                    <div className="flex items-center justify-center text-blue-600">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>
                      <span className="ml-2 text-sm">已通知管理员，等待确认中...</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-center mt-2 text-gray-400">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400"></div>
                      <span className="ml-1.5 text-xs">等待支付...</span>
                    </div>
                    <button
                      onClick={() => setClaimedPaid(true)}
                      className="mt-3 w-full py-2 bg-green-500 text-white text-sm rounded hover:bg-green-600 transition-colors"
                    >
                      我已支付
                    </button>
                  </>
                )}
                <button
                  onClick={handleCloseOrder}
                  className="mt-2 w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  取消支付
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
