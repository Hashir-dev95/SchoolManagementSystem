import type { createProtectedEvidenceService } from './protected-evidence.service';

/**
 * Production evidence composition is deliberately absent until a reviewed
 * private storage provider and malware scanner are deployed. This immutable
 * null entry point keeps uploads and reads unavailable instead of falling back
 * to development storage or an always-clean scanner.
 */
export const protectedEvidenceRuntime: ReturnType<typeof createProtectedEvidenceService> | null = null;
