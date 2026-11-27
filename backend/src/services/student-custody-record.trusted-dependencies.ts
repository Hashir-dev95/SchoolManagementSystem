import type { CustodyRecordAuthorization } from './student-custody-record.service';
import type { EvidenceAuthorizationRequest, EvidenceDto } from './protected-evidence.service';
import type { CustodyRecordActor } from './student-custody-record.service';

/**
 * Production custody authority is intentionally not wired. These fixed
 * dependencies deny until a separately approved domain authorizer and
 * authenticated evidence reader are composed by the application.
 */
export async function authorizeStudentCustodyRecord(
  _request: CustodyRecordAuthorization,
): Promise<boolean> {
  return false;
}

export async function readStudentCustodyEvidence(_input: {
  actor: CustodyRecordActor;
  evidenceId: string;
  authorize: (request: EvidenceAuthorizationRequest) => Promise<boolean>;
}): Promise<{ metadata: EvidenceDto; content: Buffer; contentType: string }> {
  throw new Error('Custody evidence access is not configured');
}
