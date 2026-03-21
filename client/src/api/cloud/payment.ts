import httpClient from './httpClient'
import type {
  ApiResponse,
  PaymentPackage,
  CreateOrderRequest,
  OrderInfo,
  OrderStatusResponse,
} from '@/types'

export const paymentApi = {
  getPackages() {
    return httpClient.get<ApiResponse<PaymentPackage[]>>('/api/v1/payment/packages')
  },

  createOrder(data: CreateOrderRequest) {
    return httpClient.post<ApiResponse<OrderInfo>>('/api/v1/payment/create-order', data)
  },

  getOrderStatus(orderNo: string) {
    return httpClient.get<ApiResponse<OrderStatusResponse>>('/api/v1/payment/order-status', {
      params: { order_no: orderNo },
    })
  },
}
