import { mock } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CollectorVerificationRecordAuthorizer, CollectorVerificationRecordActor } from '../../src/services/collector-verification-record.service';
import type { EvidenceAuthorizationRequest, EvidenceDto } from '../../src/services/protected-evidence.service';

type Reader = (input: { actor: CollectorVerificationRecordActor; evidenceId: string; authorize: (request: EvidenceAuthorizationRequest) => Promise<boolean> }) => Promise<{ metadata: EvidenceDto; content: Buffer; contentType: string }>;
let authorizeCurrent: CollectorVerificationRecordAuthorizer = async () => false;
let readerCurrent: Reader = async () => { throw new Error('test evidence reader not configured'); };
export function setCollectorVerificationTestDependencies(input: { authorize: CollectorVerificationRecordAuthorizer; readEvidence: Reader }) {
  authorizeCurrent = input.authorize;
  readerCurrent = input.readEvidence;
}
const exports = {
  authorizeCollectorVerificationRecord: (request: Parameters<CollectorVerificationRecordAuthorizer>[0]) => authorizeCurrent(request),
  readCollectorVerificationEvidence: (input: Parameters<Reader>[0]) => readerCurrent(input),
};
mock.module(pathToFileURL(resolve(process.cwd(), 'src/services/collector-verification-record.trusted-dependencies.ts')), { exports });
