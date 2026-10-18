// Secret redaction applied to every string before it is sent to the extractor or stored.
const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED:private-key]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, '[REDACTED:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, '[REDACTED:github-token]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED:slack-token]'],
  [/\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED:api-key]'],
  [/\b(?:pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, '[REDACTED:api-key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED:jwt]'],
  [/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._~-]{16,}/g, '$1 [REDACTED]'],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, '$1[REDACTED]@'],
  [/\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|AUTH_KEY)[A-Z0-9_]*)(\s*[=:]\s*)["']?[^\s"',;]{6,}["']?/gi, '$1$2[REDACTED]'],
];

export function redact(s: string): string {
  let out = s;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
