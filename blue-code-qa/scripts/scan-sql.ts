/**
 * Static SQL-injection scanner for the REAL backend (the reference app has no SQL).
 * Flags SQL built by string interpolation/concatenation, and unsafe raw-query APIs.
 *   node scripts/scan-sql.ts <backend-src-dir>
 * Heuristic: expect some false positives; every finding needs human review. Parameterised queries ($1, ?, :name, tagged templates
 * from a safe library) are NOT flagged.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SqlFinding { rule: string; file: string; line: number; snippet: string }
/** A line "looks like SQL" only with real statement shapes, so ordinary words like "select-plan" are not matched. */
const SQL_STMT = /\b(select\s+[\w*`"'.,\s()]+?\s+from\s|insert\s+into\s|update\s+[\w."`]+\s+set\s|delete\s+from\s|\bwhere\s+\w+\s*(=|in|like)\b|union\s+select)/i;
const CONCAT = /["'`]\s*\+\s*[A-Za-z_(]|[A-Za-z_)\]]\s*\+\s*["'`]/;
const RULES: Array<{ rule: string; test: (l: string) => boolean }> = [
  { rule: 'template-interpolated-sql', test: (l) => /`[^`]*\$\{[^}]+\}[^`]*`/.test(l) && SQL_STMT.test(l) && !/\bsql`|Prisma\.sql|\bpgFormat/i.test(l) },
  { rule: 'concatenated-sql', test: (l) => CONCAT.test(l) && SQL_STMT.test(l) },
  { rule: 'unsafe-raw-api', test: (l) => /\$queryRawUnsafe|\$executeRawUnsafe|\.raw\(\s*`[^`]*\$\{|sequelize\.query\(\s*`[^`]*\$\{/.test(l) },
  { rule: 'string-format-sql', test: (l) => /format\(\s*["'`].*\b(select|insert|update|delete)\b.*%[sd]/i.test(l) },
];

export function scanSql(dir: string): SqlFinding[] {
  const out: SqlFinding[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === '.git' || n === 'dist') continue;
      const p = path.join(d, n); const st = statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|js|mjs|cjs)$/.test(n) || /\.test\.|\.spec\./.test(n)) continue;
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => { for (const r of RULES) if (r.test(line)) out.push({ rule: r.rule, file: path.relative(dir, p), line: i + 1, snippet: line.trim().slice(0, 140) }); });
    }
  };
  walk(dir);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const f = scanSql(path.resolve(process.argv[2] ?? '.'));
  for (const x of f) console.log(`[SQLI?] ${x.rule} ${x.file}:${x.line}  ${x.snippet}`);
  console.log(f.length ? `\n${f.length} potential issue(s) — review each` : 'No string-built SQL detected.');
  process.exit(f.length ? 1 : 0);
}
