import {Types} from 'mongoose';

import User from '../models/user';
import SafetyAlert, {
  SAFETY_ALERT_SEVERITIES,
  SAFETY_ALERT_STATUSES,
  SAFETY_ALERT_TYPES,
  SafetyAlertType,
} from '../models/safetyAlert';

export interface SafetyAlertSummary {
  total: number;
  open: number;
  inProgress: number;
  critical: number;
  high: number;
  byType: Record<SafetyAlertType, number>;
}

const validateObjectId = (
  value: string,
  fieldName: string,
): void => {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
};

const createEmptyTypeCounts = (): Record<SafetyAlertType, number> => ({
  [SAFETY_ALERT_TYPES.MISSING_ATTENDANCE]: 0,
  [SAFETY_ALERT_TYPES.SUBSTITUTE_GAP]: 0,
  [SAFETY_ALERT_TYPES.BUS_EXCEPTION]: 0,
  [SAFETY_ALERT_TYPES.GATE_EXCEPTION]: 0,
  [SAFETY_ALERT_TYPES.INCIDENT]: 0,
  [SAFETY_ALERT_TYPES.HELPDESK]: 0,
  [SAFETY_ALERT_TYPES.BACKUP_FAILURE]: 0,
});

export const getBranchSafetyAlertSummary = async (
  branchId: string,
): Promise<SafetyAlertSummary> => {
  validateObjectId(branchId, 'branch ID');

  const branchObjectId = new Types.ObjectId(branchId);

  const summary = await SafetyAlert.aggregate<{
    _id: SafetyAlertType;
    count: number;
  }>([
    {
      $match: {
        branchId: branchObjectId,
        status: {
          $in: [
            SAFETY_ALERT_STATUSES.OPEN,
            SAFETY_ALERT_STATUSES.IN_PROGRESS,
          ],
        },
      },
    },
    {
      $group: {
        _id: '$type',
        count: {$sum: 1},
      },
    },
  ]);

  const byType = createEmptyTypeCounts();

  for (const item of summary) {
    if (item._id in byType) {
      byType[item._id] = item.count;
    }
  }

  const [total, open, inProgress, critical, high] =
    await Promise.all([
      SafetyAlert.collection.countDocuments({
        branchId: branchObjectId,
        status: {
          $in: [
            SAFETY_ALERT_STATUSES.OPEN,
            SAFETY_ALERT_STATUSES.IN_PROGRESS,
          ],
        },
      }),

      SafetyAlert.collection.countDocuments({
        branchId: branchObjectId,
        status: SAFETY_ALERT_STATUSES.OPEN,
      }),

      SafetyAlert.collection.countDocuments({
        branchId: branchObjectId,
        status: SAFETY_ALERT_STATUSES.IN_PROGRESS,
      }),

      SafetyAlert.collection.countDocuments({
        branchId: branchObjectId,
        status: {
          $in: [
            SAFETY_ALERT_STATUSES.OPEN,
            SAFETY_ALERT_STATUSES.IN_PROGRESS,
          ],
        },
        severity: SAFETY_ALERT_SEVERITIES.CRITICAL,
      }),

      SafetyAlert.collection.countDocuments({
        branchId: branchObjectId,
        status: {
          $in: [
            SAFETY_ALERT_STATUSES.OPEN,
            SAFETY_ALERT_STATUSES.IN_PROGRESS,
          ],
        },
        severity: SAFETY_ALERT_SEVERITIES.HIGH,
      }),
    ]);

  return {
    total,
    open,
    inProgress,
    critical,
    high,
    byType,
  };
};

export const getBranchSafetyAlerts = async (
  branchId: string,
): Promise<
  Array<{
    id: string;
    type: SafetyAlertType;
    title: string;
    description?: string;
    severity: string;
    status: string;
    assignedTo?: {
      id: string;
      fullName: string;
      role: string;
    } | null;
    createdAt: Date;
    updatedAt: Date;
  }>
> => {
  validateObjectId(branchId, 'branch ID');

  const alerts = await SafetyAlert.collection
    .find({
      branchId: new Types.ObjectId(branchId),
      status: {
        $in: [
          SAFETY_ALERT_STATUSES.OPEN,
          SAFETY_ALERT_STATUSES.IN_PROGRESS,
        ],
      },
    })
    .sort({createdAt: -1})
    .limit(100)
    .toArray();

  const assignedUserIds = Array.from(
    new Set(
      alerts
        .filter(
          (
            alert,
          ): alert is typeof alert & {
            assignedTo: Types.ObjectId;
          } => Boolean(alert.assignedTo),
        )
        .map(alert => alert.assignedTo.toString()),
    ),
  ).map(id => new Types.ObjectId(id));

  const assignedUsers: Array<{
    _id: Types.ObjectId;
    fullName: string;
    role: string;
  }> =
    assignedUserIds.length > 0
      ? await User.find({
          _id: {$in: assignedUserIds},
        }).select('_id fullName role')
      : [];

  const assignedUserMap: Map<
    string,
    {
      id: string;
      fullName: string;
      role: string;
    }
  > = new Map(
    assignedUsers.map(
      (
        user: {
          _id: Types.ObjectId;
          fullName: string;
          role: string;
        },
      ) => [
        user._id.toString(),
        {
          id: user._id.toString(),
          fullName: user.fullName,
          role: user.role,
        },
      ],
    ),
  );

  return alerts.map(alert => ({
    id: alert._id.toString(),
    type: alert.type as SafetyAlertType,
    title: alert.title,
    ...(alert.description
      ? {description: alert.description}
      : {}),
    severity: alert.severity,
    status: alert.status,
    assignedTo: alert.assignedTo
      ? assignedUserMap.get(
          alert.assignedTo.toString(),
        ) ?? null
      : null,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  }));
};

export type SafetyAlertAction =
  | 'assign'
  | 'resolve'
  | 'escalate';

export interface SafetyAlertActionInput {
  alertId: string;
  actorId: string;
  branchId: string;
  action: SafetyAlertAction;
  assignedTo?: string;
}

export const processSafetyAlertAction = async (
  data: SafetyAlertActionInput,
): Promise<void> => {
  validateObjectId(data.alertId, 'alert ID');
  validateObjectId(data.actorId, 'actor ID');
  validateObjectId(data.branchId, 'branch ID');

  const alertId = new Types.ObjectId(data.alertId);
  const branchObjectId = new Types.ObjectId(data.branchId);

  const alert = await SafetyAlert.collection.findOne({
    _id: alertId,
    branchId: branchObjectId,
  });

  if (!alert) {
    throw new Error('Safety alert not found');
  }

  if (alert.status === SAFETY_ALERT_STATUSES.RESOLVED) {
    throw new Error('Resolved safety alert cannot be modified');
  }

  const actor = await User.findById(data.actorId)
    .select('_id role branchId isActive')
    .exec();

  if (!actor) {
    throw new Error('Actor not found');
  }

  if (!actor.isActive) {
    throw new Error('Actor account is inactive');
  }

  if (
    !actor.branchId ||
    actor.branchId.toString() !== data.branchId
  ) {
    throw new Error('Actor is outside branch scope');
  }

  if (
    data.action !== 'assign' &&
    data.action !== 'resolve' &&
    data.action !== 'escalate'
  ) {
    throw new Error('Invalid safety alert action');
  }

  const update: {
    assignedTo?: Types.ObjectId;
    status?: string;
    resolvedAt?: Date;
    severity?: string;
  } = {};

  if (data.action === 'assign') {
    if (!data.assignedTo) {
      throw new Error('Assigned user is required');
    }

    validateObjectId(
      data.assignedTo,
      'assigned user ID',
    );

    const assignedUser = await User.findById(
      data.assignedTo,
    )
      .select('_id role branchId isActive')
      .exec();

    if (!assignedUser) {
      throw new Error('Assigned user not found');
    }

    if (!assignedUser.isActive) {
      throw new Error(
        'Assigned user account is inactive',
      );
    }

    if (
      !assignedUser.branchId ||
      assignedUser.branchId.toString() !== data.branchId
    ) {
      throw new Error(
        'Assigned user is outside branch scope',
      );
    }

    update.assignedTo = assignedUser._id;
    update.status = SAFETY_ALERT_STATUSES.IN_PROGRESS;
  }

  if (data.action === 'resolve') {
    update.status = SAFETY_ALERT_STATUSES.RESOLVED;
    update.resolvedAt = new Date();
  }

  if (data.action === 'escalate') {
    update.severity =
      SAFETY_ALERT_SEVERITIES.CRITICAL;
    update.status =
      SAFETY_ALERT_STATUSES.IN_PROGRESS;
  }

  const result = await SafetyAlert.collection.updateOne(
    {
      _id: alertId,
      branchId: branchObjectId,
      status: {
        $ne: SAFETY_ALERT_STATUSES.RESOLVED,
      },
    },
    {
      $set: update,
    },
  );

  if (result.matchedCount === 0) {
    throw new Error(
      'Safety alert was already resolved or no longer available',
    );
  }
};