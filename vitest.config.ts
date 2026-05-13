import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Excluded:
      //   - main.ts: only useful via the bundle, exercised by `self-smoke` in CI.
      //   - version.ts: a constant.
      //   - client.ts: thin SDK wrapper exercised by every command test
      //     indirectly; mocking `B2Client.authorize` to add direct coverage
      //     would just duplicate the simulator setup the commands already use.
      exclude: ['src/main.ts', 'src/version.ts', 'src/client.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        // Tightened after the coverage-stress pass. Headroom of ~2 points
        // each so deleting one stress test doesn't auto-fail the gate.
        statements: 95,
        branches: 85,
        functions: 100,
        lines: 95,
      },
    },
  },
})
