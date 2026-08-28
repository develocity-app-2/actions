// Fork delta: upstream also loads `@gradle-tech/develocity-agent/jest-reporter`, which is not an
// npm dependency -- upstream CI installs it into ~/.node_libraries with `pacote extract` before
// running tests. This fork has no CI and runs `npm test` from a clean checkout, where resolving
// that reporter throws before a single test runs. Nothing else here differs from upstream.
export default {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts', 'json'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }]
  },
  reporters: ['default'],
  verbose: true
}
