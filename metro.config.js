const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { createHash } = require('node:crypto');
const {
  readApiOrigins,
  validateApiOrigin,
} = require('./config/api-origin-policy');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaults = getDefaultConfig(__dirname);
// Snapshot at Metro startup; restart Metro after changing the host environment.
const origins = readApiOrigins(process.env);
const fingerprint = createHash('sha256')
  .update(JSON.stringify(origins))
  .digest('hex');
const config = {
  cacheVersion: `${defaults.cacheVersion}:api-origins-v1:${fingerprint}`,
  transformer: {
    async getTransformOptions(...args) {
      const development = args[1].dev === true;
      validateApiOrigin(
        development ? origins.development : origins.release,
        development
      );
      return defaults.transformer.getTransformOptions(...args);
    },
  },
};

module.exports = mergeConfig(defaults, config);
