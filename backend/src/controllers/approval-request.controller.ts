import {Response} from 'express';

import {
  getPendingApprovalRequests,
  processApprovalRequest,
   getApprovalRequestById,
   ApprovalAction,
} from '../services/approval-request.service';
import {BranchScopedRequest} from '../middleware/branch.middleware';
export const getPendingApprovalRequestsController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const requests = await getPendingApprovalRequests(req.branchId);

    res.status(200).json({
      success: true,
      message: 'Pending approval requests fetched successfully',
      data: {
        requests,
        total: requests.length,
      },
    });
  } catch (error) {
    console.error('Pending approval requests error:', error);

    const message =
      error instanceof Error
        ? error.message
        : 'Failed to fetch pending approval requests';

    res.status(500).json({
      success: false,
      message,
    });
  }
};

export const processApprovalRequestController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const requestId = String(req.params.requestId);
    const {
      action,
      reason,
      delegatedTo,
      delegationExpiresAt,
    } = req.body;

    const allowedActions: ApprovalAction[] = [
      'approved',
      'rejected',
      'changes_requested',
      'delegated',
    ];

    if (!allowedActions.includes(action)) {
      res.status(400).json({
        success: false,
        message: 'Invalid approval action',
      });
      return;
    }

    let parsedDelegationExpiry: Date | undefined;

    if (delegationExpiresAt !== undefined) {
      parsedDelegationExpiry = new Date(delegationExpiresAt);

      if (Number.isNaN(parsedDelegationExpiry.getTime())) {
        res.status(400).json({
          success: false,
          message: 'Invalid delegation expiry',
        });
        return;
      }
    }

    const approvalRequest = await processApprovalRequest({
      requestId,
      actorId: req.user.userId,
      branchId: req.branchId,
      action,
      reason,
      delegatedTo,
      delegationExpiresAt: parsedDelegationExpiry,
    });

    res.status(200).json({
      success: true,
      message: `Approval request ${action} successfully`,
      data: {
        request: approvalRequest,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to process approval request';

    if (
      message === 'Invalid request ID' ||
      message === 'Invalid actor ID' ||
      message === 'Invalid branch ID' ||
      message === 'Invalid approval action' ||
      message === 'Invalid delegation expiry' ||
      message === 'Reason is required for rejection or change request' ||
      message === 'Delegate user is required' ||
      message === 'Delegation expiry is required' ||
      message === 'Delegation expiry must be in the future' ||
      message === 'Requester cannot approve their own request' ||
      message === 'Requester cannot be assigned as delegate' ||
      message === 'Approver cannot delegate to themselves'
    ) {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (
      message === 'Approval request not found' ||
      message === 'Approver not found' ||
      message === 'Delegate user not found'
    ) {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    if (
      message === 'Approval request is outside branch scope' ||
      message === 'Approver is outside branch scope' ||
      message === 'Approver is not authorized' ||
      message === 'Delegate is outside branch scope' ||
      message === 'Approver account is inactive' ||
      message === 'Delegate account is inactive' ||
      message === 'Only pending approval requests can be processed'
    ) {
      res.status(
        message === 'Only pending approval requests can be processed'
          ? 409
          : 403,
      ).json({
        success: false,
        message,
      });
      return;
    }

    console.error('Process approval request error:', error);

    res.status(500).json({
      success: false,
      message,
    });
  }
};
export const getApprovalRequestByIdController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const requestId = String(req.params.requestId);

    if (!requestId || requestId === 'undefined') {
      res.status(400).json({
        success: false,
        message: 'Approval request ID is required',
      });
      return;
    }

    const data = await getApprovalRequestById(
      requestId,
      req.branchId,
    );

    res.status(200).json({
      success: true,
      message: 'Approval request fetched successfully',
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to fetch approval request';

    if (message === 'Invalid request ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (message === 'Invalid branch ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (message === 'Approval request not found') {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch approval request',
    });
  }
};
