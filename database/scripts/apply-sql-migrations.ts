/**
 * Applies prisma/migrations/*\/migration.sql in lexical order using plain `pg`.
 *
 * Purpose: environments where the Prisma schema-engine binary is unavailable (offline CI, sandboxes) and the
 * Jest test-suite bootstrap. Production/staging MUST use `prisma migrate deploy` (it keeps the
 * _prisma_migrations bookkeeping table). This script keeps its own tiny `_sql_migrations` table, so do not mix
 * the two on the same database.
 *
 * Usage: DATABASE_URL=... tsx scripts/apply-sql-migrations.ts [--reset]   (--reset drops schema "public"; DEV ONLY)
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export async function applySqlMigrations(connectionString: string, opts: { reset?: boolean } = {}): Promise<string[]> {
  const url = new URL(connectionString);
  url.searchParams.delete('schema'); // `schema` is a Prisma-only parameter
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const applied: string[] = [];
  try {
    if (opts.reset) {
      await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    }
    await client.query(
      'CREATE TABLE IF NOT EXISTS _sql_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of names) {
      const done = await client.query('SELECT 1 FROM _sql_migrations WHERE name = $1', [name]);
      if (done.rowCount) continue;
      const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _sql_migrations(name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const reset = process.argv.includes('--reset');
  if (reset && process.env.NODE_ENV === 'production') throw new Error('Refusing --reset in production');
  applySqlMigrations(url, { reset })
    .then((a) => console.log(a.length ? `Applied: ${a.join(', ')}` : 'Database already up to date'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
