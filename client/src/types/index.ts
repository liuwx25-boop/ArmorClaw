// Docker related types
export interface DockerStatus {
  platform: 'macos' | 'windows' | 'linux'
  dockerDesktopInstalled: boolean
  colimaInstalled: boolean
  wsl2Installed: boolean
  dockerRunning: boolean
  containerExists: boolean
  containerRunning: boolean
  needsSetup: boolean
}

export interface InstallProgress {
  step: string
  progress: number
  message: string
}

// User related types
export interface User {
  id: number
  username: string
  email: string
  points_balance: number
  created_at: string
}

// Points related types
export interface PointsBalance {
  total: number
  used: number
  available: number
}

// API response wrapper
export interface ApiResponse<T = unknown> {
  code: number
  msg: string
  data: T
}

// Auth related types
export interface AuthTokens {
  token: string
  refresh_token: string
  expires_in: number
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
  confirm_password: string
}

export interface AuthResponse extends AuthTokens {
  user: User
}

export interface ResetPasswordRequest {
  reset_token: string
  new_password: string
  confirm_password: string
}

// --- Models & API Keys ---

export type BillingMode = 'token' | 'per_request' | 'image' | 'dimension'
export type ModelType = 'llm' | 'image_gen' | 'video_gen'

export interface AiModelPriceTier {
  id: number
  ai_model_id: number
  min_context_length: number
  max_context_length: number | null
  sale_input_price: number
  sale_output_price: number
  sale_cached_input_price: number | null
  sale_cache_storage_price: number | null
}

export interface AiModelImagePrice {
  id: number
  ai_model_id: number
  resolution: string
  sale_price: number
  cost_price: number
}

export interface AiModelDimensionPrice {
  id: number
  model_id: string
  resolution: string
  max_duration_seconds: number
  has_audio: boolean
  custom_voice: boolean
  sale_price: number
}

export interface AiModel {
  model_id: string
  model_name: string
  input_points_per_1k: number
  output_points_per_1k: number
  price_tiers?: AiModelPriceTier[]
  model_type?: ModelType
  billing_mode?: BillingMode
  per_request_price?: number
  dimension_prices?: AiModelDimensionPrice[]
  image_prices?: AiModelImagePrice[]
}

export type ApiKeyStatus = 'inactive' | 'active'

export interface ApiKeyItem {
  key_id: number
  api_key: string
  creator_id: number
  status: ApiKeyStatus
  created_at: string
}

export interface CreateApiKeyResponse {
  key_id: number
  api_key: string
  creator_id: number
  created_at: string
}

export interface ActivateModelRequest {
  api_key: string
  model_id: string
}

export interface ActivateModelResponse {
  key_id: number
  status: 'active'
}

// --- Billing ---

export interface BillingBalance {
  points_balance: number
  today_consumed_points: number
  week_consumed_points: number
  month_consumed_points: number
}

export interface BillingRecord {
  request_time: string
  model_id: string
  billing_mode: BillingMode
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  points_input: number
  points_output: number
  points_cached_input: number
  points_total: number
  // per_request 模式
  image_count?: number | null
  // dimension 模式
  video_resolution?: string | null
  video_duration_seconds?: number | null
  has_audio?: boolean | null
  custom_voice?: boolean | null
}

export interface BillingRecordsParams {
  page?: number
  size?: number
  start_date?: string
  end_date?: string
  model_id?: string
}

export interface BillingRecordsResponse {
  total: number
  records: BillingRecord[]
}

// --- Payment ---

export interface PaymentPackage {
  package_id: number
  name: string
  points: number
  price: number
  discount: number
  validity: string
}

export interface CreateOrderRequest {
  package_id: number
  payment_method: number
}

export interface OrderInfo {
  order_no: string
  amount: number
  payment_url: string
  qrcode_url: string
  payment_method: number
  expire_time: string
}

export interface OrderStatusResponse {
  order_no: string
  status: number
  paid_at?: string
}

// --- Chat Proxy ---

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionsRequest {
  model_id: string
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
}
