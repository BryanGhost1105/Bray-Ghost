const PROMPT_OVERRIDE_PATTERNS = [
  /\b(?:ignore|disregard|override)\b.{0,60}\b(?:previous|above|prior|system|developer|instructions?|prompt)\b/i,
  /\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/i,
  /\b(?:reveal|print|expose|leak|send|email|exfiltrate)\b.{0,60}\b(?:secrets?|api[ _-]?keys?|credentials?|passwords?|tokens?)\b/i,
  /\bact\s+as\b.{0,40}\b(?:system|developer|admin|assistant)\b/i,
]

/** Serialize scraped/external values so they remain data, not prompt structure. */
export function encodeUntrustedPromptData(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

/** A defense-in-depth output check; separation and system rules remain primary. */
export function containsPromptOverride(text: string): boolean {
  return PROMPT_OVERRIDE_PATTERNS.some((pattern) => pattern.test(text))
}
