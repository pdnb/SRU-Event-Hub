/** E2E tests run against a real PostgreSQL (docker compose) with seeded reference/demo data. */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/test/tsconfig.json' }] },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 60_000,
};
