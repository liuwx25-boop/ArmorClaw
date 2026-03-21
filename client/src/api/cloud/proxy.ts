import type { ChatCompletionsRequest } from '@/types'

import { getServerBaseUrlSync } from '@/utils/server-url'

interface SseCallbacks {
  onChunk?: (delta: string) => void
  onDone?: () => void
  onError?: (error: Error) => void
}

function getAuthToken(): string | undefined {
  const raw = localStorage.getItem('auth-storage')
  if (!raw) return undefined
  try {
    return JSON.parse(raw)?.state?.token
  } catch {
    return undefined
  }
}

/**
 * SSE streaming chat completions.
 *
 * Usage:
 *   const abort = new AbortController()
 *   await chatCompletions(
 *     { model_id: 'deepseek-chat', messages: [...], stream: true },
 *     { onChunk: (d) => console.log(d), onDone: () => {}, onError: (e) => {} },
 *     abort.signal,
 *   )
 */
export async function chatCompletions(
  request: ChatCompletionsRequest,
  callbacks: SseCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const baseUrl = getServerBaseUrlSync()
  const token = getAuthToken()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/v1/proxy/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...request, stream: true }),
      signal,
    })
  } catch (err) {
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)))
    return
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (body?.msg) message = body.msg
    } catch { /* ignore */ }
    callbacks.onError?.(new Error(message))
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError?.(new Error('Response body is not readable'))
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // Keep incomplete last line in buffer
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            callbacks.onDone?.()
            return
          }
          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta?.content
            if (delta) {
              callbacks.onChunk?.(delta)
            }
          } catch { /* ignore non-JSON lines */ }
        }
      }
    }
    // Stream ended without [DONE]
    callbacks.onDone?.()
  } catch (err) {
    if (signal?.aborted) return
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)))
  }
}
