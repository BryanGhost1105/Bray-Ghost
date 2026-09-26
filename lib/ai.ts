import {
  DEEPSEEK_API_URL,
  DEEPSEEK_MODEL,
  GEMINI_MODEL,
  DEEPSEEK_TEMPERATURE,
  AI_TIMEOUT_MS,
  MAX_AI_ATTEMPTS,
} from './constants'

// Single shared AI client used by email generation, follow-up writing,
// and niche expansion. Supports both Google Gemini Flash (Free Tier) and DeepSeek.
// Every caller supplies a `parse` function that turns the raw JSON response
// into its own shape; retries on network errors, timeouts, and unparseable/mismatched
// responses are handled once here.

// Returns the configured API key, or null when unset.
export function getAiApiKey(): string | null {
  return process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY || null
}
export class AiUnavailableError extends Error {}

function isGeminiKey(key: string): boolean {
  // Google AI Studio / Gemini keys typically start with AQ... or AIza...
  // Or when GEMINI_API_KEY or AI_API_KEY is set and DEEPSEEK_API_KEY is not.
  if (process.env.GEMINI_API_KEY) return true
  if (key.startsWith('AQ.') || key.startsWith('AIza')) return true
  if (process.env.AI_API_KEY && !process.env.DEEPSEEK_API_KEY) return true
  return false
}
async function callGeminiApi<T>(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  parse: (value: unknown) => T | null
): Promise<T> {
  const model = GEMINI_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userMessage }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: DEEPSEEK_TEMPERATURE,
        },
      }),
      signal: controller.signal,
    })

    if (res.status === 401 || res.status === 403) {
      throw new AiUnavailableError(
        `Gemini API auth/config error (${res.status}): ${await res.text()}`
      )
    }

    if (!res.ok) {
      throw new Error(`Gemini API error (${res.status}): ${await res.text()}`)
    }

    const data = await res.json()
    let content = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) throw new Error('Empty response from Gemini API')

    content = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    const parsed = JSON.parse(content)
    const result = parse(parsed)
    if (result !== null) return result
    throw new Error('Gemini response did not match the expected format')
  } finally {
    clearTimeout(timeoutId)
  }
}

async function callDeepSeekApi<T>(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  parse: (value: unknown) => T | null
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: DEEPSEEK_TEMPERATURE,
      }),
      signal: controller.signal,
    })

    if (res.status === 401 || res.status === 403) {
      throw new AiUnavailableError(
        `DeepSeek API auth/config error (${res.status}): ${await res.text()}`
      )
    }
    if (!res.ok) {
      throw new Error(`DeepSeek API error: ${res.status} ${await res.text()}`)
    }

    const data = await res.json()
    let content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty response from DeepSeek API')

    content = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    const parsed = JSON.parse(content)
    const result = parse(parsed)
    if (result !== null) return result
    throw new Error('Response did not match the expected format')
  } finally {
    clearTimeout(timeoutId)
  }
}

// Calls AI (Gemini or DeepSeek) with the given prompts and returns the parsed result.
export async function callDeepSeekJson<T>(
  systemPrompt: string,
  userMessage: string,
  parse: (value: unknown) => T | null
): Promise<T> {
  const apiKey = getAiApiKey()
  if (!apiKey) {
    throw new Error('AI_API_KEY, GEMINI_API_KEY, or DEEPSEEK_API_KEY is not set in environment variables.')
  }

  const useGemini = isGeminiKey(apiKey)
  let lastError = `No usable response after ${MAX_AI_ATTEMPTS} attempts`

  for (let attempt = 0; attempt < MAX_AI_ATTEMPTS; attempt++) {
    try {
      if (useGemini) {
        return await callGeminiApi(apiKey, systemPrompt, userMessage, parse)
      } else {
        return await callDeepSeekApi(apiKey, systemPrompt, userMessage, parse)
      }
    } catch (err) {
      if (err instanceof AiUnavailableError) throw err
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  throw new AiUnavailableError(lastError)
}

export interface AiEmailContent {
  subject: string
  body: string
}

// Shared validator for email-generation responses ({ subject, body }).
export function parseEmailResponse(value: unknown): AiEmailContent | null {
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  if (typeof obj.subject === 'string' && typeof obj.body === 'string') {
    return { subject: obj.subject, body: obj.body }
  }
  return null
}

