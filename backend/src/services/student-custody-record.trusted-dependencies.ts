import { protectedEvidenceRuntime } from './protected-evidence-runtime';
import type { EvidenceAuthorizationRequest } from './protected-evidence.service';
import type { CustodyRecordActor } from './student-custody-record.service';
import type { CustodyRecordAuthorization } from './student-custody-record.service';

/** Defer model-backed authorization loading until after service construction. */
export async function authorizeStudentCustodyRecord(request: CustodyRecordAuthorization) {
  const trusted = await import('./custody-record-trusted-authorization.js');
  return trusted.authorizeStudentCustodyRecord(request);
}

export async function readStudentCustodyEvidence(input: {
  actor: CustodyRecordActor; evidenceId: string;
  authorize: (request: EvidenceAuthorizationRequest) => Promise<boolean>;
}) {
  if (!protectedEvidenceRuntime) throw new Error('Protected evidence service is unavailable');
  return protectedEvidenceRuntime.readAvailable({ ...input, authorize: input.authorize });
}
