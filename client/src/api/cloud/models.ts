import httpClient from './httpClient'
import type {
  ApiResponse,
  AiModel,
  ApiKeyItem,
  CreateApiKeyResponse,
  ActivateModelRequest,
  ActivateModelResponse,
} from '@/types'

export const modelsApi = {
  getModels() {
    return httpClient.get<ApiResponse<AiModel[]>>('/api/v1/models')
  },

  createApiKey() {
    return httpClient.post<ApiResponse<CreateApiKeyResponse>>('/api/v1/models/api-keys')
  },

  listApiKeys() {
    return httpClient.get<ApiResponse<ApiKeyItem[]>>('/api/v1/models/api-keys')
  },

  getApiKeyPlaintext(keyId: number) {
    return httpClient.get<ApiResponse<{ api_key: string }>>(`/api/v1/models/api-keys/${keyId}`)
  },

  deleteApiKey(keyId: number) {
    return httpClient.delete<ApiResponse<null>>(`/api/v1/models/api-keys/${keyId}`)
  },

  activateModel(data: ActivateModelRequest) {
    return httpClient.post<ApiResponse<ActivateModelResponse>>('/api/v1/models/activate', data)
  },
}
