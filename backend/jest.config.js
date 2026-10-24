/** @type {import('jest').Config} */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { isolatedModules: true } }] },
  testEnvironment: 'node',
};

module.exports = {
  testTimeout: 60000,
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
      globalSetup: '<rootDir>/test/integration/global-setup.ts',
      setupFiles: ['<rootDir>/test/integration/env.ts'],
    },
  ],
};
