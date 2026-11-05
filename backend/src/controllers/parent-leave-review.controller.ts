import type { Response } from 'express';
import type { BranchScopedRequest } from '../middleware/branch.middleware';
import { ApprovalAccessError } from '../services/approval-authority.policy';
import {
  decideParentLeave,
  getParentLeaveReview,
  listParentLeaveReviews,
} from '../services/parent-leave-review.service';
import { RequestContractError } from '../utils/request-validation';

export const readParentLeaveReviews =
  (kind: 'queue' | 'detail' | 'decision') =>
  async (req: BranchScopedRequest, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!req.user)
        throw new ApprovalAccessError(401, 'Authentication required');
      if (!req.branchId)
        throw new ApprovalAccessError(403, 'Branch scope is required');
      const reader = {
        actorId: req.user.userId,
        branchId: req.branchId,
        token: req.headers.authorization?.slice(7) ?? '',
      };
      const data =
        kind === 'queue'
          ? { requests: await listParentLeaveReviews(reader) }
          : kind === 'detail'
          ? await getParentLeaveReview(reader, String(req.params.approvalId))
          : await decideParentLeave(
              reader,
              String(req.params.approvalId),
              req.body,
            );
      res.json({ success: true, data });
    } catch (error) {
      const expected =
        error instanceof ApprovalAccessError ||
        error instanceof RequestContractError;
      res.status(expected ? error.status : 500).json({
        success: false,
        message: expected
          ? error.message
          : 'Parent leave review is unavailable',
      });
    }
  };
