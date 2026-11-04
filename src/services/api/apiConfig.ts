import { validateApiOrigin } from '../../../config/api-origin-policy';

// Only this module's markers are replaced by the build-host Babel plugin.
// Keep the developer literal inside the __DEV__ branch for release elimination.
export function getApiBaseUrl(): string {
  if (__DEV__) {
    return `${validateApiOrigin('__SCHOOL_APP_DEV_API_ORIGIN__', true)}/api`;
  }
  return `${validateApiOrigin('__SCHOOL_APP_RELEASE_API_ORIGIN__', false)}/api`;
}
