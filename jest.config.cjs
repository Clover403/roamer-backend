/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  restoreMocks: true,
  setupFiles: ['<rootDir>/tests/setup/env.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
