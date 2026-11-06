/** Structured JSON logger with defence-in-depth redaction (key-based, PAN-based and literal-secret-based). */
export interface LogSink {
  write(line: string): void;
}

export const consoleSink: LogSink = { write: (l) => process.stdout.write(l + '\n') };

export class MemorySink implements LogSink {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
  text(): string {
    return this.lines.join('\n');
  }
  records(): Array<Record<string, unknown>> {
    return this.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  }
}

const SENSITIVE_KEY = /(pass(word)?|salt|secret|token|authorization|cookie|hash|cvv|cvc|card|pan|signature|^key$|merchant_?key|payu_?key)/i;

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const KV_SECRET = /\b([A-Za-z0-9_]*(?:pass(?:word|wd)?|pwd|secret|token|salt|api[_-]?key|authorization|cookie))\b(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|Bearer\s+\S+|[^\s,;&"')]+)/gi;
const URL_CREDS = /(\/\/[^\/\s:@]+:)([^@\s\/]+)@/g;

/** Scrubs card numbers and secrets embedded in free text (e.g. driver errors such as "password=..." or "postgres://u:pw@host"). */
export function scrubString(s: string): string {
  return s
    .replace(URL_CREDS, '$1[REDACTED]@')
    .replace(KV_SECRET, '$1$2[REDACTED]')
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
      const digits = m.replace(/[ -]/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '[REDACTED_PAN]' : m;
    });
}

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value.length > 2000 ? value.slice(0, 2000) + '…[truncated]' : value);
  if (typeof value !== 'object') return typeof value === 'function' ? '[function]' : value;
  if (depth > 6) return '[depth-limit]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message), code: (value as { code?: unknown }).code };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1, seen);
  }
  return out;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'security';

export class Logger {
  private readonly sink: LogSink;
  private readonly secrets: string[];
  private readonly base: Record<string, unknown>;

  constructor(sink: LogSink, opts: { secrets?: string[]; base?: Record<string, unknown> } = {}) {
    this.sink = sink;
    this.secrets = (opts.secrets ?? []).filter((s) => s.length >= 6);
    this.base = opts.base ?? {};
  }

  child(base: Record<string, unknown>): Logger {
    return new Logger(this.sink, { secrets: this.secrets, base: { ...this.base, ...base } });
  }

  private emit(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    const rec = { ts: new Date().toISOString(), level, event, ...(redact({ ...this.base, ...fields }) as object) };
    let line = JSON.stringify(rec);
    for (const s of this.secrets) line = line.split(s).join('[REDACTED]');
    this.sink.write(line);
  }

  debug(event: string, f?: Record<string, unknown>): void { this.emit('debug', event, f); }
  info(event: string, f?: Record<string, unknown>): void { this.emit('info', event, f); }
  warn(event: string, f?: Record<string, unknown>): void { this.emit('warn', event, f); }
  error(event: string, f?: Record<string, unknown>): void { this.emit('error', event, f); }
  /** Security-relevant events (forged callbacks, throttling, CSRF failures). Always retained. */
  security(event: string, f?: Record<string, unknown>): void { this.emit('security', event, f); }
}
