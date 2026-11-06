import 'dotenv/config';
import { applySqlMigrations } from '../../scripts/apply-sql-migrations';

/** Rebuilds the test database from the real migration files before the suite. WIPES schema "public". */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required (use a throw-away database: it is wiped)');
  if (!/test/i.test(new URL(url).pathname)) throw new Error('Refusing to wipe a database whose name does not contain "test"');
  await applySqlMigrations(url, { reset: true });
}
