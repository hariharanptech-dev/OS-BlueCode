import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanSql } from '../../scripts/scan-sql.ts';

const run = (code: string) => { const d = mkdtempSync(path.join(tmpdir(), 'sql-')); writeFileSync(path.join(d, 'repo.ts'), code); try { return scanSql(d).map((f) => f.rule); } finally { rmSync(d, { recursive: true }); } };

describe('static SQL-injection scanner (applies to the REAL backend; reference app has no SQL)', () => {
  it('flags interpolated SQL templates', () => assert.deepEqual(run('db.query(`SELECT * FROM orders WHERE id = ${id}`)'), ['template-interpolated-sql']));
  it('flags concatenated SQL', () => assert.ok(run(`db.query("SELECT * FROM users WHERE email = '" + email + "'")`).includes('concatenated-sql')));
  it('flags unsafe raw APIs', () => assert.ok(run('prisma.$queryRawUnsafe(`SELECT ${col} FROM t`)').includes('unsafe-raw-api')));
  it('flags format-string SQL', () => assert.ok(run(`db.query(format("SELECT * FROM t WHERE a = '%s'", a))`).length > 0));
  it('accepts parameterised queries', () => {
    assert.deepEqual(run('db.query("SELECT * FROM orders WHERE id = $1", [id])'), []);
    assert.deepEqual(run('db.query("UPDATE orders SET status = ? WHERE id = ?", [s, id])'), []);
    assert.deepEqual(run('const q = sql`SELECT * FROM orders WHERE id = ${id}`'), []);
    assert.deepEqual(run('logger.info(`updated ${count} rows`)'), []);
  });
  it('the reference implementation contains no string-built SQL', () => assert.deepEqual(scanSql(path.resolve(import.meta.dirname, '../../src')), []));
});
