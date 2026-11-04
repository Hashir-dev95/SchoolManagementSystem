const path = require('node:path');
const { validateApiOrigin } = require('../config/api-origin-policy');

// Never embed malformed/credential-bearing values from the unselected setting.
// Metro rejects an invalid selected setting; runtime rejects the empty marker value.
function publicLiteral(value, development) {
  try {
    return validateApiOrigin(value, development);
  } catch {
    return '';
  }
}

// Environment values arrive only through the two allowlisted Babel options.
module.exports = function apiOrigins({ types }, origins) {
  const target = path.resolve(__dirname, '../src/services/api/apiConfig.ts');
  return {
    name: 'school-app-api-origins',
    visitor: {
      StringLiteral(nodePath, state) {
        if (!state.filename || path.resolve(state.filename) !== target) return;
        const value = nodePath.node.value;
        if (value === '__SCHOOL_APP_DEV_API_ORIGIN__') {
          nodePath.replaceWith(
            types.stringLiteral(publicLiteral(origins.development, true)),
          );
          nodePath.skip();
        } else if (value === '__SCHOOL_APP_RELEASE_API_ORIGIN__') {
          nodePath.replaceWith(
            types.stringLiteral(publicLiteral(origins.release, false)),
          );
          nodePath.skip();
        }
      },
    },
  };
};
