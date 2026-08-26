import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // nanoid v5 is ESM-only; map to a CJS-compatible mock for ts-jest
    '^nanoid$': '<rootDir>/test-utils/nanoidMock.ts',
    // `server-only` throws on import outside a server context, which is its
    // whole job. Every test importing a server module would otherwise have to
    // remember to mock it; map it to nothing once, here.
    '^server-only$': '<rootDir>/test-utils/serverOnlyMock.ts',
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.tsx',
    '!src/app/**/*.tsx',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
  },
};

export default config;
