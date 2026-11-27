import { mock } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CustodyRecordAuthorizer, CustodyRecordActor } from '../../src/services/student-custody-record.service';
import type { EvidenceAuthorizationRequest, EvidenceDto } from '../../src/services/protected-evidence.service';

type ReadEvidence = (input: {
  actor: CustodyRecordActor;
  evidenceId: string;
  authorize: (request: EvidenceAuthorizationRequest) => Promise<boolean>;
}) => Promise<{ metadata: EvidenceDto; content: Buffer; contentType: string }>;

let currentAuthorize: CustodyRecordAuthorizer = async () => false;
let currentReadEvidence: ReadEvidence = async () => { throw new Error('test evidence reader not configured'); };

export function setStudentCustodyTestDependencies(dependencies: {
  authorize: CustodyRecordAuthorizer;
  readEvidence: ReadEvidence;
}) {
  currentAuthorize = dependencies.authorize;
  currentReadEvidence = dependencies.readEvidence;
}

// This mock exists only in the test runner process. Production has no setter,
// factory argument or configuration API for replacing these dependencies.
const mockedExports = {
  authorizeStudentCustodyRecord: (request: Parameters<CustodyRecordAuthorizer>[0]) => currentAuthorize(request),
  readStudentCustodyEvidence: (input: Parameters<ReadEvidence>[0]) => currentReadEvidence(input),
};
const trustedDependencyPath = resolve(process.cwd(), 'src/services/student-custody-record.trusted-dependencies.ts');
mock.module(pathToFileURL(trustedDependencyPath), { exports: mockedExports });
