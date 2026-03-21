import { create } from 'zustand'
import { billingApi } from '@/api/cloud/billing'
import type { BillingBalance, BillingRecord, BillingRecordsParams } from '@/types'

interface BillingState {
  balance: BillingBalance | null
  records: BillingRecord[]
  totalRecords: number
  loading: boolean
  error: string | null

  fetchBalance: () => Promise<void>
  fetchRecords: (params?: BillingRecordsParams) => Promise<void>
  clearError: () => void
}

export const useBillingStore = create<BillingState>()((set) => ({
  balance: null,
  records: [],
  totalRecords: 0,
  loading: false,
  error: null,

  fetchBalance: async () => {
    try {
      const res = await billingApi.getBalance()
      set({ balance: res.data.data ?? null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '获取余额失败' })
    }
  },

  fetchRecords: async (params) => {
    set({ loading: true, error: null })
    try {
      const res = await billingApi.getRecords(params)
      const data = res.data.data
      set({
        records: data?.records ?? [],
        totalRecords: data?.total ?? 0,
        loading: false,
      })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : '获取消费记录失败',
      })
    }
  },

  clearError: () => set({ error: null }),
}))
