/** Stable JSON contracts for the B2-5B mobile client. Dates are ISO strings
 * after Express serialization; identifiers are canonical lowercase ObjectIds. */
export type CustodyAdministrativeState =
  | 'draft' | 'submitted' | 'changes_requested' | 'review_completed'
  | 'withdrawn' | 'revoked' | 'invalidated';

export type CustodyEvidenceSummaryDto = Readonly<{
  evidenceId: string;
  revision: number;
  contentType: 'application/pdf' | 'image/png' | 'image/jpeg';
  byteLength: number;
  attachedAt: string;
}>;

export type CustodyHistoryEntryDto = Readonly<{
  revision: number;
  action: string;
  state: CustodyAdministrativeState;
  reason: string;
  at: string;
}>;

export type StudentCustodyRecordDto = Readonly<{
  id: string; branchId: string; studentId: string; enrollmentId: string;
  academicPeriodId: string; classId: string; sectionId: string;
  state: CustodyAdministrativeState; revision: number; summary: string;
  createdAt: string; updatedAt: string; evidence: readonly CustodyEvidenceSummaryDto[];
}>;
export type StudentCustodyRecordDetailDto = Readonly<{
  record: StudentCustodyRecordDto;
  history: readonly CustodyHistoryEntryDto[];
}>;

export type CollectorVerificationRecordDto = Readonly<{
  id: string; pickupPersonId: string; pickupAuthorizationId: string;
  submissionCycle: number; branchId: string; studentId: string; enrollmentId: string;
  academicPeriodId: string; classId: string; sectionId: string;
  state: CustodyAdministrativeState; revision: number; summary: string;
  createdAt: string; updatedAt: string; evidence: readonly CustodyEvidenceSummaryDto[];
}>;
export type CollectorVerificationRecordDetailDto = Readonly<{
  record: CollectorVerificationRecordDto;
  history: readonly CustodyHistoryEntryDto[];
}>;

export type RecordPageDto<T> = Readonly<{ items: readonly T[]; nextCursor: string | null }>;
export type CreateStudentCustodyRecordRequest = Readonly<{ enrollmentId: string; summary: string; operationId: string }>;
export type CreateCollectorVerificationRecordRequest = Readonly<{ summary: string; operationId: string }>;
export type DraftEditRequest = Readonly<{ expectedRevision: number; operationId: string; summary: string; reason: string }>;
export type LifecycleMutationRequest = Readonly<{ expectedRevision: number; operationId: string; reason: string }>;
export type EvidenceAssociationRequest = Readonly<{ evidenceId: string; expectedRevision: number; operationId: string }>;
export type EvidenceUploadContract = Readonly<{
  contentType: 'application/pdf' | 'image/png' | 'image/jpeg';
  maximumBytes: 10_000_000;
  idempotencyKeyHeader: 'Idempotency-Key';
}>;
export type ProtectedEvidenceDto = Readonly<{
  evidenceId: string; domain: 'custody'; purpose: 'verification';
  status: 'intent' | 'quarantined' | 'available' | 'failed' | 'deletion_pending' | 'deleted';
  contentType: 'application/pdf' | 'image/png' | 'image/jpeg' | null;
  byteLength: number | null; revision: number; createdAt: string; updatedAt: string;
}>;
export type CustodyApiErrorDto = Readonly<{
  success: false;
  message: string;
}>;
