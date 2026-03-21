import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useBillingStore } from '@/stores/billingStore'
import { modelsApi } from '@/api/cloud/models'
import type { AiModel, BillingRecordsParams } from '@/types'

export default function Billing() {
  const { t } = useTranslation('billing')
  const { balance, records, totalRecords, loading, error, fetchBalance, fetchRecords, clearError } = useBillingStore()

  // 筛选状态
  const [modelId, setModelId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // 翻页状态
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 模型列表（用于下拉筛选）
  const [models, setModels] = useState<AiModel[]>([])

  // 加载模型列表
  useEffect(() => {
    modelsApi.getModels().then(res => {
      setModels(res.data.data || [])
    }).catch(() => {})
  }, [])

  // 构建请求参数
  const buildParams = useCallback((): BillingRecordsParams => {
    const params: BillingRecordsParams = { page, size: pageSize }
    if (modelId) params.model_id = modelId
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    return params
  }, [page, pageSize, modelId, startDate, endDate])

  // 加载数据
  useEffect(() => {
    fetchRecords(buildParams())
  }, [fetchRecords, buildParams])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  // 筛选变化时重置到第1页
  const handleFilter = () => {
    setPage(1)
  }

  // 重置筛选
  const handleReset = () => {
    setModelId('')
    setStartDate('')
    setEndDate('')
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize))

  // 生成页码列表
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push('...')
      const start = Math.max(2, page - 1)
      const end = Math.min(totalPages - 1, page + 1)
      for (let i = start; i <= end; i++) pages.push(i)
      if (page < totalPages - 2) pages.push('...')
      pages.push(totalPages)
    }
    return pages
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-2">{t('title')}</h1>
      <p className="text-sm text-gray-500 mb-6">{t('subtitle')}</p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-red-700">{error}</span>
          <button onClick={clearError} className="text-sm text-red-600 hover:text-red-800 ml-4">✕</button>
        </div>
      )}

      {/* 概览卡片 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t('balance.current')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {balance ? balance.points_balance.toLocaleString() : '--'}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t('balance.monthly')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {balance ? balance.month_consumed_points.toLocaleString() : '--'}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t('balance.weekly')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {balance ? balance.week_consumed_points.toLocaleString() : '--'}
          </p>
        </div>
      </div>

      {/* 使用记录表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-700">
            {t('table.title')}
            {totalRecords > 0 && <span className="text-xs text-gray-400 font-normal ml-2">{t('table.total', { count: totalRecords })}</span>}
          </h2>
          <button
            onClick={() => { fetchBalance(); fetchRecords(buildParams()) }}
            className="text-sm text-blue-500 hover:text-blue-600"
          >
            {t('refresh')}
          </button>
        </div>

        {/* 筛选栏 */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-3 flex-wrap">
          <select
            value={modelId}
            onChange={e => { setModelId(e.target.value); handleFilter() }}
            className="h-8 px-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">{t('filter.allModels')}</option>
            {models.map(m => (
              <option key={m.model_id} value={m.model_id}>{m.model_name}</option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); handleFilter() }}
              className="h-8 px-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <span className="text-gray-400 text-sm">~</span>
            <input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); handleFilter() }}
              className="h-8 px-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {(modelId || startDate || endDate) && (
            <button
              onClick={handleReset}
              className="h-8 px-3 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-md bg-white"
            >
              {t('filter.reset')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span className="ml-2 text-gray-500 text-sm">{t('loading')}</span>
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            {t('empty')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <th className="text-left px-4 py-3 font-medium">{t('table.time')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('table.model')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('table.type')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('table.details')}</th>
                <th className="text-right px-4 py-3 font-medium">{t('table.points')}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record, idx) => {
                const billingMode = record.billing_mode || 'token'
                let typeLabel = t('types.text')
                let usageDetail = ''

                switch (billingMode) {
                  case 'image':
                    typeLabel = t('types.image')
                    usageDetail = `${record.image_count ?? 1} 张图片`
                    break
                  case 'per_request':
                    typeLabel = t('types.image')
                    usageDetail = `${record.image_count ?? 1} 张图片`
                    break
                  case 'dimension':
                    typeLabel = t('types.video')
                    usageDetail = [
                      record.video_resolution,
                      record.video_duration_seconds != null ? `${record.video_duration_seconds}s` : null,
                      record.has_audio ? '含音频' : null,
                      record.custom_voice ? '指定音色' : null,
                    ].filter(Boolean).join(' · ') || '--'
                    break
                  default:
                    typeLabel = t('types.text')
                    usageDetail = `输入 ${(record.input_tokens / 1000).toFixed(1)}K / 输出 ${(record.output_tokens / 1000).toFixed(1)}K tokens`
                }

                return (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{record.request_time}</td>
                    <td className="px-4 py-3 text-gray-800">{record.model_id}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        billingMode === 'image' || billingMode === 'per_request' ? 'bg-purple-100 text-purple-700' :
                        billingMode === 'dimension' ? 'bg-orange-100 text-orange-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {typeLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{usageDetail}</td>
                    <td className="px-4 py-3 text-gray-800 text-right font-medium">{record.points_total.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* 翻页栏 */}
        {totalRecords > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>{t('pagination.perPage')}</span>
              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
                className="h-7 px-1.5 border border-gray-300 rounded bg-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>{t('pagination.items')}</span>
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="h-7 px-2 text-sm border border-gray-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                {t('pagination.prevPage')}
              </button>
              {getPageNumbers().map((p, i) =>
                typeof p === 'string' ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-gray-400 text-sm">...</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`h-7 w-7 text-sm rounded border ${
                      p === page
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="h-7 px-2 text-sm border border-gray-300 rounded bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                {t('pagination.nextPage')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
