import type {
  CollectorVerificationRecordAuthorization,
  CollectorVerificationRecordActor,
} from './collector-verification-record.service';
import type { EvidenceAuthorizationRequest, EvidenceDto } from './protected-evidence.service';

/** No approved Parent/reviewer domain authorizer is wired for this internal
 * foundation. Production access stays denied until that authority is approved. */
export async function authorizeCollectorVerificationRecord(
  _request: CollectorVerificationRecordAuthorization,
): Promise<boolean> {
  return false;
}

/** Protected evidence access is fixed-deny until the trusted B2-2 composition
 * has an approved collector-specific authorizer. This creates no upload path. */
export async function readCollectorVerificationEvidence(_input: {
  actor: CollectorVerificationRecordActor;
  evidenceId: string;
  authorize: (request: EvidenceAuthorizationRequest) => Promise<boolean>;
}): Promise<{ metadata: EvidenceDto; content: Buffer; contentType: string }> {
  throw new Error('Collector verification evidence access is not configured');
}
