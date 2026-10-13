module.exports = {
  preset: '@react-native/jest-preset',
  // Backend security suites use node:test and owned ephemeral databases.
  // Keep the frontend runner away from legacy database scripts.
  testMatch: [
    '<rootDir>/__tests__/**/*.test.ts',
    '<rootDir>/__tests__/**/*.test.tsx',
  ],
};
