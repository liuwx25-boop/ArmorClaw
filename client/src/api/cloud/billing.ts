import httpClient from './httpClient'
import type {
  ApiResponse,
  BillingBalance,
  BillingRecordsParams,
  BillingRecordsResponse,
} from '@/types'

export const billingApi = {
  getBalance() {
    return httpClient.get<ApiResponse<BillingBalance>>('/api/v1/billing/balance')
  },

  getRecords(params?: BillingRecordsParams) {
    return httpClient.get<ApiResponse<BillingRecordsResponse>>('/api/v1/billing/records', { params })
  },
}
