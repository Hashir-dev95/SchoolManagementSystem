import {Response} from 'express';
import {BranchScopedRequest} from '../middleware/branch.middleware';
import {ApprovalAccessError} from '../services/approval-authority.policy';
import {ApprovalAction, getPendingApprovalRequests, getApprovalRequestById, processApprovalRequest} from '../services/approval-request.service';

const failure = (res: Response, error: unknown) => {
  res.status(error instanceof ApprovalAccessError ? error.status : 500).json({
    success: false,
    message: error instanceof ApprovalAccessError ? error.message : 'Approval request operation failed',
  });
};
const scope = (req: BranchScopedRequest) => {
  if (!req.user) throw new ApprovalAccessError(401, 'Authentication required');
  if (!req.branchId) throw new ApprovalAccessError(403, 'Branch scope is required');
  return {actorId: req.user.userId, branchId: req.branchId};
};

export const getPendingApprovalRequestsController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {actorId, branchId} = scope(req);
    const requests = await getPendingApprovalRequests(branchId, actorId);
    res.status(200).json({success: true, message: 'Pending approval requests fetched successfully', data: {requests, total: requests.length}});
  } catch (error) {failure(res, error);}
};

export const getApprovalRequestByIdController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {actorId, branchId} = scope(req);
    const data = await getApprovalRequestById(String(req.params.requestId), branchId, actorId);
    res.status(200).json({success: true, message: 'Approval request fetched successfully', data});
  } catch (error) {failure(res, error);}
};

export const processApprovalRequestController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {actorId, branchId} = scope(req);
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApprovalAccessError(400, 'Invalid approval request body');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !['action', 'reason', 'delegatedTo', 'delegationExpiresAt'].includes(key))) {
      throw new ApprovalAccessError(400, 'Unsupported approval request fields');
    }
    if (typeof input.action !== 'string' || !['approved', 'rejected', 'changes_requested', 'delegated'].includes(input.action)) {
      throw new ApprovalAccessError(400, 'Invalid approval action');
    }
    if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.trim().length > 500)) {
      throw new ApprovalAccessError(400, 'Invalid decision reason');
    }
    let delegatedTo: string | undefined;
    let delegationExpiresAt: Date | undefined;
    if (input.action === 'delegated') {
      if (typeof input.delegatedTo !== 'string' || typeof input.delegationExpiresAt !== 'string') {
        throw new ApprovalAccessError(400, 'Delegate and expiry are required');
      }
      delegatedTo = input.delegatedTo;
      delegationExpiresAt = new Date(input.delegationExpiresAt);
      if (!Number.isFinite(delegationExpiresAt.getTime())) throw new ApprovalAccessError(400, 'Invalid delegation expiry');
    } else if (input.delegatedTo !== undefined || input.delegationExpiresAt !== undefined) {
      throw new ApprovalAccessError(400, 'Delegation fields require a delegation action');
    }
    const request = await processApprovalRequest({
      requestId: String(req.params.requestId), actorId, branchId,
      action: input.action as ApprovalAction,
      reason: input.reason as string | undefined, delegatedTo, delegationExpiresAt,
    });
    res.status(200).json({success: true, message: 'Approval request processed successfully', data: {request}});
  } catch (error) {failure(res, error);}
};
