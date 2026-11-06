/** Tests run against a REAL PostgreSQL database (TEST_DATABASE_URL). No mocks for DB behaviour. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  globalSetup: '<rootDir>/tests/setup/globalSetup.ts',
  maxWorkers: 1,
  testTimeout: 30000,
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }] },
};
