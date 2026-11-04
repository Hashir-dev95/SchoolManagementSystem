const { readApiOrigins } = require('./config/api-origin-policy');

module.exports = function configureBabel(api) {
  api.cache.invalidate(() => JSON.stringify(readApiOrigins(process.env)));
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      [
        require.resolve('./scripts/babel-plugin-api-origins'),
        readApiOrigins(process.env),
      ],
    ],
  };
};
