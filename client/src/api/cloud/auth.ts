import httpClient from './httpClient'
import type { ApiResponse, AuthResponse, LoginRequest, RegisterRequest, ResetPasswordRequest, User } from '@/types'

export const authApi = {
  register(data: RegisterRequest) {
    return httpClient.post<ApiResponse<AuthResponse>>('/api/v1/auth/register', data)
  },

  login(data: LoginRequest) {
    return httpClient.post<ApiResponse<AuthResponse>>('/api/v1/auth/login', data)
  },

  sendResetCode(email: string) {
    return httpClient.post<ApiResponse<{ code: string; message: string }>>('/api/v1/auth/send-reset-code', { email })
  },

  verifyResetCode(email: string, code: string) {
    return httpClient.post<ApiResponse<{ reset_token: string }>>('/api/v1/auth/verify-reset-code', { email, code })
  },

  resetPassword(data: ResetPasswordRequest) {
    return httpClient.post<ApiResponse<{ message: string }>>('/api/v1/auth/reset-password', data)
  },

  getProfile() {
    return httpClient.get<ApiResponse<User>>('/api/v1/user/profile')
  },
}
