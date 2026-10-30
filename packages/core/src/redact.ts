/**
 * redact.ts — pure text-redaction utility.
 *
 * Replaces common secret patterns with a safe placeholder so that sensitive
 * values are never forwarded to the LLM or written to logs.
 *
 * Must NOT import from any other package.
 */

const REDACTED = "[REDACTED]";

/**
 * Each rule is a regex paired with a replacement string.
 * Capture groups in `pattern` that should be preserved (e.g. the key name in
 * `password=<value>`) use group 1; the replacement must reference `$1`.
 */
const RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // ── AWS credentials ──────────────────────────────────────────────────────
  // AWS Access Key IDs  (AKIA…, ASIA…, AROA…, ANPA…, ANVA…, AIDA…, AIPA…)
  {
    pattern: /\b(A(?:KIA|SIA|ROA|NPA|NVA|IDA|IPA)[A-Z0-9]{16})\b/g,
    replacement: REDACTED,
  },
  // AWS Secret Access Keys — 40-char base64-ish strings after "aws_secret" or
  // after an access-key-id context; capture via common env-var style pattern
  {
    pattern:
      /((?:aws[_-]?secret[_-]?access[_-]?key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*)[A-Za-z0-9/+]{40}/gi,
    replacement: `$1${REDACTED}`,
  },

  // ── Bearer / Authorization header tokens ────────────────────────────────
  // "Authorization: Bearer <token>"  or  "bearer <token>" anywhere
  {
    pattern: /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: `$1${REDACTED}`,
  },
  // Generic "token" key/value pairs — value may be optionally quoted
  {
    pattern: /((?:api[_-]?token|access[_-]?token|auth[_-]?token)\s*[=:]\s*)"?([^"\s,;]+)"?/gi,
    replacement: `$1${REDACTED}`,
  },

  // ── Passwords ────────────────────────────────────────────────────────────
  // password=<value>  or  password:<value>  (URL-encoded or plain)
  {
    pattern: /(password\s*[=:]\s*)[^\s"'&,;]+/gi,
    replacement: `$1${REDACTED}`,
  },
  // "passwd" variant
  {
    pattern: /(passwd\s*[=:]\s*)[^\s"'&,;]+/gi,
    replacement: `$1${REDACTED}`,
  },

  // ── JWTs ─────────────────────────────────────────────────────────────────
  // Three base64url segments separated by dots; the header always decodes to
  // '{"alg":' so it starts with eyJ
  {
    pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/]*/g,
    replacement: REDACTED,
  },

  // ── Generic API keys / secrets ───────────────────────────────────────────
  // "x-api-key: <value>"  or  "api_key=<value>"
  {
    pattern: /((?:x[-_]?api[-_]?key|apikey|api[_-]?key)\s*[=:]\s*)[\w\-./]+/gi,
    replacement: `$1${REDACTED}`,
  },
  // "secret" standalone key/value
  {
    pattern: /((?:client[_-]?secret|app[_-]?secret|secret[_-]?key)\s*[=:]\s*)[\w\-./]+/gi,
    replacement: `$1${REDACTED}`,
  },

  // ── Email addresses ──────────────────────────────────────────────────────
  // Standard email regex; keep domain for context if needed — spec says redact.
  {
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    replacement: REDACTED,
  },
];

/**
 * Apply every redaction rule to `text` and return the sanitised string.
 * The function is pure and deterministic for the same input.
 */
export function redact(text: string): string {
  let result = text;
  for (const { pattern, replacement } of RULES) {
    // Reset lastIndex so stateful regexes work correctly across calls.
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}
