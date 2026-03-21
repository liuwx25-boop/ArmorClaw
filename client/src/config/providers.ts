export interface ProviderPreset {
  id: string
  name: string
  category: 'coding-plan' | 'standard'
  baseUrl: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // Coding Plan
  {
    id: 'volcengine-coding-plan',
    name: '火山引擎 Coding Plan',
    category: 'coding-plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
  },
  {
    id: 'GLM-coding-plan',
    name: '智谱 Coding Plan',
    category: 'coding-plan',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  },
  {
    id: 'aliyun-coding-plan',
    name: '阿里云百炼 Coding Plan',
    category: 'coding-plan',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
  },
  {
    id: 'tencent-coding-plan',
    name: '腾讯云 Coding Plan',
    category: 'coding-plan',
    baseUrl: 'https://api.lkeap.cloud.tencent.com/coding/v3',
  },
   {
    id: 'kimi-code',
    name: 'kimi code',
    category: 'coding-plan',
    baseUrl: 'https://api.kimi.com/coding/v1',
  },
  {
    id: 'Minimax-code',
    name: 'Minimax code',
    category: 'coding-plan',
    baseUrl: 'https://api.minimaxi.com/v1',
  },
  // 标准 API
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'standard',
    baseUrl: 'https://api.deepseek.com/chat/completions',
  },
  {
    id: 'tencent cloud deepseek',
    name: '腾讯云deepseek',
    category: 'standard',
    baseUrl: 'https://api.lkeap.cloud.tencent.com/v1/chat/completions',
  },
  {
    id: 'aliyun-bailian',
    name: '阿里云百炼大模型',
    category: 'standard',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
]
