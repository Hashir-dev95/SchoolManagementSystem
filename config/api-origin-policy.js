// Public endpoint configuration only. This module also runs on-device: no Node APIs.
const DEV_SETTING = 'SCHOOL_APP_DEV_API_ORIGIN';
const RELEASE_SETTING = 'SCHOOL_APP_RELEASE_API_ORIGIN';

/** @param {boolean} development */
function configurationError(development) {
  const setting = development ? DEV_SETTING : RELEASE_SETTING;
  const error = new Error(
    `Invalid or missing ${setting}: expected ${
      development ? 'an HTTP/HTTPS' : 'an HTTPS public DNS'
    } origin without credentials, path, query or fragment.`
  );
  error.name = 'ApiConfigurationError';
  return error;
}

/** @param {string} value */
function ipv4(value) {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
  );
}

/** @param {string} value */
function ipv6(value) {
  if (value.includes('.')) {
    const split = value.lastIndexOf(':');
    if (!ipv4(value.slice(split + 1))) return false;
    value = value.slice(0, split + 1) + '0:0';
  }
  const halves = value.split('::');
  if (halves.length > 2) return false;
  const parts = halves.flatMap(half => (half ? half.split(':') : []));
  return (
    parts.every(part => /^[a-f\d]{1,4}$/i.test(part)) &&
    (halves.length === 2 ? parts.length < 8 : parts.length === 8)
  );
}

/**
 * Deliberately accepts a conservative ASCII origin grammar, not arbitrary URLs.
 * Public DNS routing/TLS ownership is a deployment check, not a string guarantee.
 * @param {unknown} value
 * @param {boolean} development Only an explicit true permits development policy.
 * @returns {string}
 */
function validateApiOrigin(value, development) {
  const fail = () => configurationError(development === true);
  if (typeof value !== 'string' || !value || value.trim() !== value)
    throw fail();
  const match =
    /^(https?):\/\/(\[[a-f\d:.]+\]|[a-z\d.-]+)(?::(\d{1,5}))?\/?$/i.exec(value);
  if (!match) throw fail();
  const scheme = match[1].toLowerCase();
  const host = match[2].toLowerCase();
  const port = match[3] === undefined ? undefined : Number(match[3]);
  if (port !== undefined && (port < 1 || port > 65535)) throw fail();
  const literal = host.startsWith('[');
  if (literal) {
    if (!ipv6(host.slice(1, -1))) throw fail();
  } else {
    if (
      host.length > 253 ||
      !host
        .split('.')
        .every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)) ||
      (/^[\d.]+$/.test(host) && !ipv4(host))
    )
      throw fail();
  }
  if (development !== true) {
    const labels = host.split('.');
    const localSuffixes = [
      'localhost',
      'local',
      'localdomain',
      'internal',
      'intranet',
      'lan',
      'home',
      'home.arpa',
      'corp',
      'onion',
      'test',
      'invalid',
      'example',
    ];
    if (
      scheme !== 'https' ||
      literal ||
      ipv4(host) ||
      labels.length < 2 ||
      !/^(?:[a-z]{2,63}|xn--[a-z\d-]{2,59})$/.test(labels[labels.length - 1]) ||
      localSuffixes.some(
        suffix => host === suffix || host.endsWith('.' + suffix)
      )
    )
      throw fail();
  }
  const defaultPort = scheme === 'https' ? 443 : 80;
  return `${scheme}://${host}${
    port !== undefined && port !== defaultPort ? ':' + port : ''
  }`;
}

/**
 * Build hosts pass their environment explicitly; the mobile runtime never reads it.
 * @param {{SCHOOL_APP_DEV_API_ORIGIN?: string, SCHOOL_APP_RELEASE_API_ORIGIN?: string}} environment
 */
function readApiOrigins(environment) {
  return {
    development: environment.SCHOOL_APP_DEV_API_ORIGIN ?? '',
    release: environment.SCHOOL_APP_RELEASE_API_ORIGIN ?? '',
  };
}

module.exports = { validateApiOrigin, readApiOrigins };
