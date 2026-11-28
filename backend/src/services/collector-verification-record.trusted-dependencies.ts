import { protectedEvidenceRuntime } from './protected-evidence-runtime';
import type { EvidenceAuthorizationRequest } from './protected-evidence.service';
import type { CollectorVerificationRecordActor } from './collector-verification-record.service';
import type { CollectorVerificationRecordAuthorization } from './collector-verification-record.service';

/** Defer model-backed authorization loading until after service construction. */
export async function authorizeCollectorVerificationRecord(request: CollectorVerificationRecordAuthorization) {
  const trusted = await import('./custody-record-trusted-authorization.js');
  return trusted.authorizeCollectorVerificationRecord(request);
}

export async function readCollectorVerificationEvidence(input: {
  actor: CollectorVerificationRecordActor; evidenceId: string;
  authorize: (request: EvidenceAuthorizationRequest) => Promise<boolean>;
}) {
  if (!protectedEvidenceRuntime) throw new Error('Protected evidence service is unavailable');
  return protectedEvidenceRuntime.readAvailable({ ...input, authorize: input.authorize });
}
