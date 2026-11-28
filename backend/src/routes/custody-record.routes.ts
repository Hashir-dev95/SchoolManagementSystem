import { Router, type Request, type Response } from 'express';
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';
import User from '../models/user';
import Session from '../models/session';
import { studentCustodyRecordService } from '../services/student-custody-record.service';
import { collectorVerificationRecordService } from '../services/collector-verification-record.service';
import { protectedEvidenceRuntime } from '../services/protected-evidence-runtime';
import type { EvidenceAuthorizationRequest } from '../services/protected-evidence.service';
import type { RecordPageDto } from '../services/custody-record-api.contract';
import type { EvidenceActor } from '../services/protected-evidence.service';

type SafeActor = EvidenceActor;
const operationPattern = /^[A-Za-z0-9._:-]{12,128}$/;
const objectIdPattern = /^[a-f\d]{24}$/i;
const parentActions = new Set(['submit', 'withdraw']);
const reviewerActions = new Set(['request_changes', 'complete_review', 'revoke', 'invalidate']);

class ApiError extends Error {
  constructor(readonly status: number, readonly message: string) { super(message); }
}

function onlyKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) throw new ApiError(400, 'Invalid request body');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.includes(key))) throw new ApiError(400, 'Unsupported request fields');
  return row;
}
function requiredString(value: unknown, max: number, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new ApiError(400, 'Invalid request payload');
  return value.trim();
}
function requiredRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ApiError(400, 'Invalid expected revision');
  return Number(value);
}
function operationId(value: unknown): string {
  const id = requiredString(value, 128);
  if (!operationPattern.test(id)) throw new ApiError(400, 'Invalid operation identifier');
  return id;
}
function requireNoMutationQuery(req: Request) {
  if (Object.keys(req.query).length) throw new ApiError(400, 'Unsupported query fields');
}
function requireDetailRead(req: Request) {
  if (req.body !== undefined || Object.keys(req.query).length) throw new ApiError(400, 'Unsupported read request fields');
}
function pageInput(req: Request, allowed: readonly string[]) {
  if (Object.keys(req.query).some(key => !allowed.includes(key))) throw new ApiError(400, 'Unsupported query fields');
  const rawLimit = req.query.limit;
  let limit = 100;
  if (rawLimit !== undefined) {
    if (typeof rawLimit !== 'string' || !/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) throw new ApiError(400, 'Invalid page size');
    limit = Number(rawLimit);
  }
  let before: { createdAt: Date; id: string } | undefined;
  const rawCursor = req.query.cursor;
  if (rawCursor !== undefined) {
    if (typeof rawCursor !== 'string' || rawCursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) throw new ApiError(400, 'Invalid page cursor');
    try {
      const decoded = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (!decoded || Object.keys(decoded).sort().join(',') !== 'createdAt,id' || typeof decoded.createdAt !== 'string' ||
        typeof decoded.id !== 'string' || !objectIdPattern.test(decoded.id)) throw new Error();
      const createdAt = new Date(decoded.createdAt);
      if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== decoded.createdAt) throw new Error();
      before = { createdAt, id: decoded.id.toLowerCase() };
    } catch { throw new ApiError(400, 'Invalid page cursor'); }
  }
  return { limit, before };
}
function encodeCursor(cursor: { createdAt: Date; id: string } | null) {
  return cursor ? Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }), 'utf8').toString('base64url') : null;
}
function pageResponse<T>(items: readonly T[], cursor: { createdAt: Date; id: string } | null): RecordPageDto<T> {
  return Object.freeze({ items, nextCursor: encodeCursor(cursor) });
}
function param(req: Request, key: string) {
  const value = req.params[key];
  if (typeof value !== 'string' || !objectIdPattern.test(value)) throw new ApiError(404, 'Record is unavailable');
  return value.toLowerCase();
}
function queryValue(req: Request, key: string) {
  const value = req.query[key];
  if (typeof value !== 'string' || !objectIdPattern.test(value)) throw new ApiError(400, `Invalid ${key}`);
  return value.toLowerCase();
}

async function actorFromRequest(req: AuthenticatedRequest): Promise<SafeActor> {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !req.user || !objectIdPattern.test(req.user.userId)) throw new ApiError(401, 'Authentication is required');
  const [session, user] = await Promise.all([
    Session.findOne({ token, isRevoked: false }).select('_id userId role isRevoked').read('primary').lean(),
    User.findById(req.user.userId).select('_id branchId role isActive').read('primary').lean(),
  ]);
  if (!session || !user || !user.isActive || String(session.userId) !== String(user._id) ||
    session.role !== user.role || user.role !== req.user.role || !user.branchId) throw new ApiError(401, 'Authentication is unavailable');
  return { userId: String(user._id), branchId: String(user.branchId), sessionId: String(session._id) };
}

function statusFor(error: unknown) {
  if (error instanceof ApiError) return { status: error.status, message: error.message };
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'not_found') return { status: 404, message: 'Record is unavailable' };
  if (code === 'unauthorized') return { status: 403, message: 'This operation is not allowed' };
  if (code === 'invalid_request') return { status: 400, message: 'Invalid request payload' };
  if (['unsupported_content', 'content_mismatch', 'invalid_content'].includes(code)) return { status: 400, message: 'Evidence content is invalid' };
  if (code === 'conflict' || code === 'operation_conflict') return { status: 409, message: 'The record changed; refresh and retry' };
  if (code.includes('evidence') || code.includes('storage') || code.includes('scan') || code === 'not_available') return { status: 503, message: 'Protected evidence is unavailable' };
  return { status: 500, message: 'Custody record service is unavailable' };
}
function endpoint(run: (req: AuthenticatedRequest, actor: SafeActor) => Promise<unknown>, status = 200, concealAuthority = false) {
  return async (req: AuthenticatedRequest, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'GET') requireNoMutationQuery(req);
      const actor = await actorFromRequest(req);
      res.status(status).json({ success: true, data: await run(req, actor) });
    }
    catch (error) {
      const result = statusFor(error);
      const concealed = concealAuthority && error && typeof error === 'object' && 'code' in error && error.code === 'unauthorized';
      res.status(concealed ? 404 : result.status).json({ success: false, message: concealed ? 'Record is unavailable' : result.message });
    }
  };
}
const parentEndpoint = (run: (req: AuthenticatedRequest, actor: SafeActor) => Promise<unknown>, status = 200) => endpoint(run, status, true);

async function uploadEvidence(input: {
  req: AuthenticatedRequest; actor: SafeActor; domain: 'student' | 'collector';
  recordId: string; resource: { studentId: string; enrollmentId: string; requesterId?: string };
}) {
  if (!protectedEvidenceRuntime) throw new ApiError(503, 'Protected evidence storage and scanning are unavailable');
  const body = input.req.body;
  if (!Buffer.isBuffer(body) || body.length < 1 || body.length > 10_000_000) throw new ApiError(400, 'Evidence content is invalid');
  const operation = operationId(input.req.headers['idempotency-key']);
  const retentionPolicyRef = process.env.CUSTODY_EVIDENCE_RETENTION_POLICY_REF;
  if (!retentionPolicyRef || !/^[A-Za-z0-9._:-]{1,120}$/.test(retentionPolicyRef)) throw new ApiError(503, 'Protected evidence retention is not configured');
  const evidenceActor = input.actor;
  const authorize = async (request: EvidenceAuthorizationRequest) => {
    if (request.action !== 'upload' || request.domain !== 'custody' || request.purpose !== 'verification' ||
      request.ownerType !== 'student' || request.branchId !== evidenceActor.branchId ||
      request.ownerId !== input.resource.studentId || request.resourceId !== input.recordId || request.actorId !== evidenceActor.userId) return false;
    if (input.domain === 'student') return studentCustodyRecordService.authorizeEvidenceUpload({ actor: evidenceActor, recordId: input.recordId });
    return collectorVerificationRecordService.authorizeEvidenceUpload({ actor: evidenceActor, recordId: input.recordId });
  };
  const mediaType = input.req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(mediaType ?? '')) throw new ApiError(400, 'Unsupported evidence content type');
  return protectedEvidenceRuntime.ingest({
    actor: evidenceActor, operationId: operation, domain: 'custody', purpose: 'verification', ownerType: 'student',
    ownerId: input.resource.studentId, resourceId: input.recordId, retentionPolicyRef,
    declaredContentType: mediaType, source: body, authorize,
  });
}

export const parentCustodyRecordsRouter = Router({ mergeParams: true });
parentCustodyRecordsRouter.use(authenticateToken, requireRole('parent'));
parentCustodyRecordsRouter.get('/', parentEndpoint(async (req, actor) => {
  if (req.body !== undefined) throw new ApiError(400, 'Unsupported read request fields');
  const page = pageInput(req, ['enrollmentId', 'limit', 'cursor']);
  const result = await studentCustodyRecordService.listPageForStudent({ actor, studentId: param(req, 'studentId'), enrollmentId: queryValue(req, 'enrollmentId'), ...page });
  return pageResponse(result.items, result.nextCursor);
}));
parentCustodyRecordsRouter.post('/', parentEndpoint(async (req, actor) => {
  const body = onlyKeys(req.body, ['enrollmentId', 'summary', 'operationId']);
  return studentCustodyRecordService.create({ actor, studentId: param(req, 'studentId'), enrollmentId: requiredString(body.enrollmentId, 24), summary: requiredString(body.summary, 1000), operationId: operationId(body.operationId) });
}, 201));
parentCustodyRecordsRouter.get('/:recordId', parentEndpoint(async (req, actor) => { requireDetailRead(req); return studentCustodyRecordService.read({ actor, recordId: param(req, 'recordId') }); }));
parentCustodyRecordsRouter.patch('/:recordId', parentEndpoint(async (req, actor) => {
  const body = onlyKeys(req.body, ['expectedRevision', 'operationId', 'summary', 'reason']);
  return studentCustodyRecordService.mutate({ actor, recordId: param(req, 'recordId'), action: 'edit', expectedRevision: requiredRevision(body.expectedRevision), operationId: operationId(body.operationId), summary: requiredString(body.summary, 1000), reason: requiredString(body.reason, 500) });
}));
parentCustodyRecordsRouter.post('/:recordId/actions/:action', parentEndpoint(async (req, actor) => {
  const action = req.params.action;
  if (typeof action !== 'string' || !parentActions.has(action)) throw new ApiError(404, 'Operation is unavailable');
  const body = onlyKeys(req.body, ['expectedRevision', 'operationId', 'reason']);
  return studentCustodyRecordService.mutate({ actor, recordId: param(req, 'recordId'), action: action as 'submit' | 'withdraw', expectedRevision: requiredRevision(body.expectedRevision), operationId: operationId(body.operationId), reason: requiredString(body.reason, 500) });
}));
parentCustodyRecordsRouter.post('/:recordId/evidence', parentEndpoint(async (req, actor) => {
  const recordId = param(req, 'recordId');
  const detail = await studentCustodyRecordService.read({ actor, recordId });
  const record = detail.record;
  return uploadEvidence({ req, actor, domain: 'student', recordId, resource: { studentId: record.studentId, enrollmentId: record.enrollmentId } });
}, 201));
parentCustodyRecordsRouter.post('/:recordId/evidence-associations', parentEndpoint(async (req, actor) => {
  const body = onlyKeys(req.body, ['evidenceId', 'expectedRevision', 'operationId']);
  return studentCustodyRecordService.attachEvidence({ actor, recordId: param(req, 'recordId'), evidenceId: requiredString(body.evidenceId, 32), expectedRevision: requiredRevision(body.expectedRevision), operationId: operationId(body.operationId) });
}, 201));

export const parentCollectorRecordsRouter = Router({ mergeParams: true });
parentCollectorRecordsRouter.use(authenticateToken, requireRole('parent'));
parentCollectorRecordsRouter.get('/', parentEndpoint(async (req, actor) => {
  if (req.body !== undefined) throw new ApiError(400, 'Unsupported read request fields');
  const page = pageInput(req, ['limit', 'cursor']);
  const result = await collectorVerificationRecordService.listPageForStudent({ actor, authorizationId: param(req, 'authorizationId'), ...page });
  return pageResponse(result.items, result.nextCursor);
}));
parentCollectorRecordsRouter.post('/', parentEndpoint(async (req, actor) => {
  const body = onlyKeys(req.body, ['summary', 'operationId']);
  return collectorVerificationRecordService.create({ actor, authorizationId: param(req, 'authorizationId'), summary: requiredString(body.summary, 1000), operationId: operationId(body.operationId) });
}, 201));
parentCollectorRecordsRouter.get('/:recordId', parentEndpoint(async (req, actor) => { requireDetailRead(req); return collectorVerificationRecordService.read({ actor, recordId: param(req, 'recordId') }); }));
parentCollectorRecordsRouter.patch('/:recordId', parentEndpoint(async (req, actor) => {
  const body = onlyKeys(req.body, ['expectedRevision', 'operationId', 'summary', 'reason']);
  return collectorVerificationRecordService.mutate({ actor, recordId: param(req, 'recordId'), action: 'edit', expectedRevision: requiredRevision(body.expectedRevision), operationId: operationId(body.operationId), summary: requiredString(body.summary, 1000), reason: requiredString(body.reason, 500) });
}));
parentCollectorRecordsRouter.post('/:recordId/actions/:action', parentEndpoint(async (req, actor) => {
  const action = req.params.action;
  if (typeof action !== 'string' || !parentActions.has(action)) throw new ApiError(404, 'Operation is unavailable');
  const body = onlyKeys(req.body, ['expectedRevision', 'operationId', 'reason']);
  return collectorVerificationRecordService.mutate({ actor, recordId: param(req, 'recordId'), action: action as 'submit' | 'withdraw', expectedRevision: requiredRevision(body.expectedRevision), operationId: operationId(body.operationId), reason: requiredString(body.reason, 500) });
}));
parentCollectorRecordsRouter.post('/:recordId/evidence', parentEndpoint(async (req, actor) => {
  const recordId = param(req, 'recordId');
  const detail = await collectorVerificationRecordService.read({ actor, recordId });
  if (detail.record.branchId !== actor.branchId) throw new ApiError(404, 'Record is unavailable');
  return uploadEvidence({ req, actor, domain: 'collector', recordId, resource: { studentId: detail.record.studentId, enrollmentId: detail.record.enrollmentId, requesterId: actor.userId } });
}, 201));
parentCollectorRecordsRouter.post('/:recordId/evidence-associations', parentEndpoint(async (req, actor) => {
  const body = onlyKeys(req.body, ['evidenceId', 'expectedRevision', 'operationId']);
  return collectorVerificationRecordService.attachEvidence({ actor, recordId: param(req, 'recordId'), evidenceId: requiredString(body.evidenceId, 32), expectedRevision: requiredRevision(body.expectedRevision), operationId: operationId(body.operationId) });
}, 201));

export const principalCustodyRecordsRouter = Router();
principalCustodyRecordsRouter.use(authenticateToken, requireRole('principal'), requirePermission(PERMISSIONS.PRINCIPAL_CUSTODY_RECORDS_REVIEW));
principalCustodyRecordsRouter.get('/', endpoint(async (req, actor) => {
  if (req.body !== undefined) throw new ApiError(400, 'Unsupported read request fields');
  const page = pageInput(req, ['studentId', 'enrollmentId', 'limit', 'cursor']);
  const result = await studentCustodyRecordService.listPageForStudent({ actor, studentId: queryValue(req, 'studentId'), enrollmentId: queryValue(req, 'enrollmentId'), ...page });
  return pageResponse(result.items, result.nextCursor);
}));
principalCustodyRecordsRouter.get('/:recordId', endpoint(async (req, actor) => { requireDetailRead(req); return studentCustodyRecordService.read({ actor, recordId: param(req, 'recordId') }); }, 200, true));
principalCustodyRecordsRouter.post('/:recordId/actions/:action', endpoint(async (req, actor) => {
  const action = req.params.action;
  if (typeof action !== 'string' || !reviewerActions.has(action)) throw new ApiError(404, 'Operation is unavailable');
  const body = onlyKeys(req.body, ['expectedRevision', 'operationId', 'reason']);
  return studentCustodyRecordService.mutate({ actor, recordId: param(req, 'recordId'), action: action as 'request_changes' | 'complete_review' | 'revoke' | 'invalidate', expectedRevision: requiredRevision(body.expectedRevision), operationId: operationId(body.operationId), reason: requiredString(body.reason, 500) });
}));

export const principalCollectorRecordsRouter = Router();
principalCollectorRecordsRouter.use(authenticateToken, requireRole('principal'), requirePermission(PERMISSIONS.PRINCIPAL_CUSTODY_RECORDS_REVIEW));
principalCollectorRecordsRouter.get('/', endpoint(async (req, actor) => {
  if (req.body !== undefined) throw new ApiError(400, 'Unsupported read request fields');
  const page = pageInput(req, ['authorizationId', 'limit', 'cursor']);
  const result = await collectorVerificationRecordService.listPageForStudent({ actor, authorizationId: queryValue(req, 'authorizationId'), ...page });
  return pageResponse(result.items, result.nextCursor);
}));
principalCollectorRecordsRouter.get('/:recordId', endpoint(async (req, actor) => { requireDetailRead(req); return collectorVerificationRecordService.read({ actor, recordId: param(req, 'recordId') }); }, 200, true));
principalCollectorRecordsRouter.post('/:recordId/actions/:action', endpoint(async (req, actor) => {
  const action = req.params.action;
  if (typeof action !== 'string' || !reviewerActions.has(action)) throw new ApiError(404, 'Operation is unavailable');
  const body = onlyKeys(req.body, ['expectedRevision', 'operationId', 'reason']);
  return collectorVerificationRecordService.mutate({ actor, recordId: param(req, 'recordId'), action: action as 'request_changes' | 'complete_review' | 'revoke' | 'invalidate', expectedRevision: requiredRevision(body.expectedRevision), operationId: operationId(body.operationId), reason: requiredString(body.reason, 500) });
}));

export const custodyRecordApiError = (error: any, _req: Request, res: Response, next: (error?: unknown) => void) => {
  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') { res.status(400).json({ success: false, message: 'Invalid custody record request' }); return; }
  next(error);
};
