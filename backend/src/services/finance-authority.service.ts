import crypto from 'node:crypto';
import { Types, type ClientSession, type PipelineStage } from 'mongoose';
import User from '../models/user';
import Branch from '../models/branch';
import Session from '../models/session';
import Student from '../models/student';
import LegacyFee from '../models/fee';
import { StudentEnrollment } from '../models/studentEnrollment';
import {
  FeeStructure,
  FeeObligation,
  FinancePaymentIntent,
  FinanceTransaction,
  FinanceAudit,
} from '../models/finance';
import { PERMISSIONS, type Permission } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import { withTimetablePublication } from './teacher-timetable.service';
import {
  resolveStudentReadScope,
  type StudentReadScope,
} from './student-self-scope.service';
import { schoolToday, scheduleDate } from './school-date.service';
import { verifyAccessToken, type JwtPayload } from './jwt.service';
import {
  RequestContractError,
  objectBody,
  objectIdField,
  textField,
  enumField,
} from '../utils/request-validation';

export const FINANCE_FEE_STATUSES = [
  'due',
  'overdue',
  'partial',
  'payment_pending',
  'paid',
] as const;
const literalSearch = (value: unknown) =>
  textField(value ?? '', 'search', 80).replace(/\s+/g, ' ');
const escapedSearch = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pageNumber = (value: unknown, fallback: number, max: number, min = 0) => {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'string' ||
    !/^\d{1,5}$/.test(value) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new RequestContractError(400, 'Invalid Finance page');
  }
  return Number(value);
};

/** Read-only search. Placement is resolved by the existing strict enrollment boundary. */
export async function searchFinanceStudents(
  identity: JwtPayload | undefined,
  query: unknown,
) {
  const ctx = await financeActor(identity),
    input = objectBody(query, ['search', 'offset']);
  const search = literalSearch(input.search),
    offset = pageNumber(input.offset, 0, 10000);
  const pattern = escapedSearch(search);
  const rows = await Student.aggregate<{
    _id: Types.ObjectId;
    userId: Types.ObjectId;
  }>([
    { $match: { branchId: new Types.ObjectId(ctx.branchId), isActive: true } },
    {
      $lookup: {
        from: User.collection.name,
        localField: 'userId',
        foreignField: '_id',
        pipeline: [
          {
            $match: {
              branchId: new Types.ObjectId(ctx.branchId),
              role: 'student',
              isActive: true,
            },
          },
          { $project: { fullName: 1 } },
        ],
        as: '_identity',
      },
    },
    { $unwind: '$_identity' },
    ...(search
      ? [
          {
            $match: {
              $or: [
                { admissionNumber: { $regex: pattern, $options: 'i' } },
                { '_identity.fullName': { $regex: pattern, $options: 'i' } },
                ...(/^[a-fA-F0-9]{24}$/.test(search)
                  ? [{ _id: new Types.ObjectId(search) }]
                  : []),
              ],
            },
          },
        ]
      : []),
    { $sort: { admissionNumber: 1, _id: 1 } },
    { $skip: offset },
    { $limit: 51 },
    { $project: { _id: 1, userId: 1 } },
  ]).read('primary');
  const items = [];
  for (const row of rows.slice(0, 50)) {
    try {
      const scope = await resolveStudentReadScope(
        String(row.userId),
        ctx.branchId,
      );
      if (String(scope.student._id) !== String(row._id)) continue;
      items.push({
        id: String(row._id),
        fullName: scope.user.fullName,
        admissionNumber: scope.student.admissionNumber,
        enrollment: {
          id: String(scope.enrollment._id),
          academicPeriod: scope.period.name,
          className: scope.schoolClass.name,
          sectionName: scope.section.name,
        },
      });
    } catch (error) {
      // Invalid membership is omitted; database failures are never disguised as empty results.
      if (!(error instanceof RequestContractError) || error.status !== 403)
        throw error;
    }
  }
  if ((await financeActor(identity)).branchId !== ctx.branchId)
    throw financialDenied();
  return { items, nextOffset: rows.length > 50 ? offset + 50 : null };
}

export async function listFinanceFees(
  identity: JwtPayload | undefined,
  query: unknown,
) {
  const ctx = await financeActor(identity),
    input = objectBody(query, [
      'studentId',
      'search',
      'status',
      'offset',
      'limit',
    ]);
  const search = literalSearch(input.search),
    status =
      input.status === undefined
        ? undefined
        : enumField(input.status, 'fee status', FINANCE_FEE_STATUSES);
  const offset = pageNumber(input.offset, 0, 10000),
    limit = pageNumber(input.limit, 100, 100, 1);
  const studentId =
    input.studentId === undefined
      ? undefined
      : objectIdField(input.studentId, 'Student ID');
  if (studentId) {
    const student = await Student.findOne({ isActive: true })
      .where('_id')
      .equals(studentId)
      .where('branchId')
      .equals(ctx.branchId)
      .select('userId')
      .read('primary')
      .lean();
    if (
      !student ||
      !(await User.exists({ role: 'student', isActive: true })
        .where('_id')
        .equals(student.userId)
        .where('branchId')
        .equals(ctx.branchId)
        .read('primary'))
    )
      throw financialDenied();
  }
  const match = {
    branchId: new Types.ObjectId(ctx.branchId),
    ...(studentId ? { studentId: new Types.ObjectId(studentId) } : {}),
    ...(search
      ? {
          $or: ['title', 'challanReference', 'academicPeriodName'].map(
            field => ({
              [field]: { $regex: escapedSearch(search), $options: 'i' },
            }),
          ),
        }
      : {}),
  };
  const pipeline: PipelineStage[] = [{ $match: match }];
  if (status) {
    // Query-side narrowing mirrors feeDTO's precedence, before pagination. The returned
    // money and status still come only from feeDTO, including its reconciliation checks.
    for (const [from, alias, filter] of [
      [
        FinanceTransaction.collection.name,
        '_settlements',
        { state: 'settled' },
      ],
      [
        FinancePaymentIntent.collection.name,
        '_holds',
        { status: { $in: reservedStates } },
      ],
    ] as const)
      pipeline.push({
        $lookup: {
          from,
          let: { fee: '$_id', student: '$studentId' },
          pipeline: [
            {
              $match: {
                branchId: new Types.ObjectId(ctx.branchId),
                ...filter,
                $expr: {
                  $and: [
                    { $eq: ['$obligationId', '$$fee'] },
                    { $eq: ['$studentId', '$$student'] },
                  ],
                },
              },
            },
            { $group: { _id: null, total: { $sum: '$amountMinor' } } },
          ],
          as: alias,
        },
      });
    pipeline.push({
      $set: {
        _paid: { $ifNull: [{ $arrayElemAt: ['$_settlements.total', 0] }, 0] },
        _held: { $ifNull: [{ $arrayElemAt: ['$_holds.total', 0] }, 0] },
      },
    });
    pipeline.push({
      $set: { _balance: { $subtract: ['$amountMinor', '$_paid'] } },
    });
    const conditions: Record<typeof status, object> = {
      paid: { _balance: 0 },
      payment_pending: { _balance: { $gt: 0 }, _held: { $gt: 0 } },
      partial: { _balance: { $gt: 0 }, _held: 0, _paid: { $gt: 0 } },
      overdue: {
        _balance: { $gt: 0 },
        _held: 0,
        _paid: 0,
        dueDate: { $lt: schoolToday() },
      },
      due: {
        _balance: { $gt: 0 },
        _held: 0,
        _paid: 0,
        dueDate: { $gte: schoolToday() },
      },
    };
    pipeline.push({ $match: conditions[status] });
  }
  pipeline.push(
    { $sort: { createdAt: -1, _id: -1 } },
    { $skip: offset },
    { $limit: limit + 1 },
    { $unset: ['_settlements', '_holds', '_paid', '_held', '_balance'] },
  );
  const rows = await FeeObligation.aggregate<Obligation>(pipeline).read(
    'primary',
  );
  const items = await Promise.all(rows.slice(0, limit).map(row => feeDTO(row)));
  if ((await financeActor(identity)).branchId !== ctx.branchId)
    throw financialDenied();
  return {
    items: status ? items.filter(item => item.status === status) : items,
    limit,
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}

export async function lookupFinanceChallan(
  identity: JwtPayload | undefined,
  reference: unknown,
) {
  const ctx = await financeActor(identity),
    value = textField(reference, 'challan reference', 80, 1);
  const row = await FeeObligation.findOne({
    branchId: ctx.branchId,
    challanReference: value,
  })
    .read('primary')
    .lean();
  if (!row)
    throw new RequestContractError(404, 'Challan not found or unavailable');
  const result = await feeDTO(row);
  if ((await financeActor(identity)).branchId !== ctx.branchId)
    throw financialDenied();
  return result;
}

export const financialDenied = () =>
  new RequestContractError(403, 'Financial record or action is unavailable');
export const reservedStates: Array<
  | 'reserved'
  | 'awaiting_verification'
  | 'provider_pending'
  | 'reconciliation_required'
  | 'settled'
  | 'rejected'
  | 'failed'
> = [
  'reserved',
  'awaiting_verification',
  'provider_pending',
  'reconciliation_required',
];
export const fingerprint = (value: unknown) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const operationKey = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(value)) {
    throw new RequestContractError(400, 'A stable operation ID is required');
  }
  return value;
};
export const safeMinor = (value: unknown) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 1000000000
  ) {
    throw new RequestContractError(
      400,
      'Positive integer minor units required',
    );
  }
  return value;
};
export const moneyLabel = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RequestContractError(503, 'Financial totals require review');
  }
  const integer = BigInt(value);
  return `PKR ${integer / 100n}.${String(integer % 100n).padStart(2, '0')}`;
};
export async function financeActor(
  identity: JwtPayload | undefined,
  permission: Permission = PERMISSIONS.FINANCE_VIEW,
  session?: ClientSession,
) {
  const actor = await currentAcademicActor(identity, session);
  if (
    actor.role !== 'finance' ||
    !ROLE_PERMISSIONS.finance.includes(permission)
  ) {
    throw financialDenied();
  }
  const branchId = await requireActiveAcademicBranch(
    actor.branchId?.toString(),
  );
  if (
    !(await Branch.exists({ isActive: true })
      .where('_id')
      .equals(branchId)
      .session(session ?? null))
  ) {
    throw financialDenied();
  }
  return { actor, branchId };
}
export async function financeWrite<T>(
  identity: JwtPayload | undefined,
  token: string,
  permission: Permission,
  action: (
    ctx: Awaited<ReturnType<typeof financeActor>>,
    session: ClientSession,
  ) => Promise<T>,
) {
  const initial = await financeActor(identity, permission);
  try {
    return await withTimetablePublication(
      initial.branchId,
      undefined,
      async session => {
        const decoded = verifyAccessToken(token);
        if (
          decoded.userId !== String(initial.actor._id) ||
          decoded.role !== 'finance'
        ) {
          throw financialDenied();
        }
        await User.collection.updateOne(
          { _id: initial.actor._id },
          { $inc: { __v: 1 } },
          { session },
        );
        const login = await Session.collection.updateOne(
          {
            token,
            userId: initial.actor._id,
            role: 'finance',
            isRevoked: false,
          },
          { $inc: { __v: 1 } },
          { session },
        );
        if (!login.matchedCount) {
          throw new RequestContractError(401, 'Session is unavailable');
        }
        const ctx = await financeActor(identity, permission, session);
        if (ctx.branchId !== initial.branchId) {
          throw financialDenied();
        }
        const result = await action(ctx, session);
        await financeActor(identity, permission, session);
        try {
          verifyAccessToken(token);
        } catch {
          throw new RequestContractError(
            401,
            'Session expired before financial commit',
          );
        }
        return result;
      },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new RequestContractError(
        409,
        'Operation or financial reference already exists',
      );
    }
    throw error;
  }
}
export async function priorOperation(
  branchId: string,
  actorId: unknown,
  operationId: string,
  hash: string,
  session: ClientSession,
) {
  const row = await FinanceAudit.findOne({
    branchId,
    actorId: String(actorId),
    operationId,
  }).session(session);
  if (row && row.fingerprint !== hash) {
    throw new RequestContractError(
      409,
      'Operation ID was used for different input',
    );
  }
  return row;
}
export async function audit(
  branchId: string,
  actorId: unknown,
  operationId: string,
  action: string,
  hash: string,
  targetId: unknown,
  session: ClientSession,
  details: {
    amountMinor?: number;
    reference?: string;
    beforeState?: string;
    afterState?: string;
  } = {},
) {
  await FinanceAudit.create(
    [
      {
        branchId,
        actorId: String(actorId),
        operationId,
        action,
        fingerprint: hash,
        targetId: String(targetId),
        ...details,
      },
    ],
    { session },
  );
}
export async function feeRecord(
  branchId: string,
  id: unknown,
  session?: ClientSession,
  lock = false,
) {
  const feeId = objectIdField(id, 'fee ID');
  if (lock) {
    await FeeObligation.updateOne(
      { _id: feeId, branchId },
      { $inc: { revision: 1 } },
    ).session(session ?? null);
  }
  const fee = await FeeObligation.findOne({ _id: feeId, branchId })
    .session(session ?? null)
    .read('primary')
    .lean();
  if (!fee) {
    throw financialDenied();
  }
  return fee;
}
export type Obligation = Awaited<ReturnType<typeof feeRecord>>;
export async function feeDTO(fee: Obligation, session?: ClientSession) {
  if (fee.currency !== 'PKR') {
    throw new RequestContractError(
      503,
      'Unsupported obligation currency requires review',
    );
  }
  const [payments, intents] = await Promise.all([
    FinanceTransaction.find({
      branchId: fee.branchId,
      obligationId: fee._id,
      studentId: fee.studentId,
      state: 'settled',
    })
      .session(session ?? null)
      .read('primary')
      .lean(),
    FinancePaymentIntent.find({
      branchId: fee.branchId,
      obligationId: fee._id,
      studentId: fee.studentId,
      status: { $in: reservedStates },
    })
      .session(session ?? null)
      .read('primary')
      .lean(),
  ]);
  const paidMinor = payments.reduce((sum, row) => sum + row.amountMinor, 0),
    reservedMinor = intents.reduce((sum, row) => sum + row.amountMinor, 0);
  const balanceMinor = fee.amountMinor - paidMinor,
    availableMinor = balanceMinor - reservedMinor;
  if (
    ![
      fee.amountMinor,
      paidMinor,
      reservedMinor,
      balanceMinor,
      availableMinor,
    ].every(v => Number.isSafeInteger(v) && v >= 0)
  ) {
    throw new RequestContractError(
      503,
      'Financial ledger requires reconciliation',
    );
  }
  return {
    id: String(fee._id),
    studentId: String(fee.studentId),
    title: fee.title,
    academicPeriod: fee.academicPeriodName,
    challanReference: fee.challanReference,
    currency: fee.currency,
    dueDate: fee.dueDate,
    amountMinor: fee.amountMinor,
    paidMinor,
    reservedMinor,
    balanceMinor,
    availableMinor,
    amountLabel: moneyLabel(fee.amountMinor),
    paidLabel: moneyLabel(paidMinor),
    reservedLabel: moneyLabel(reservedMinor),
    balanceLabel: moneyLabel(balanceMinor),
    status:
      balanceMinor === 0
        ? 'paid'
        : reservedMinor > 0
        ? 'payment_pending'
        : paidMinor > 0
        ? 'partial'
        : fee.dueDate < schoolToday()
        ? 'overdue'
        : 'due',
    receipts: payments.map(row => ({
      id: String(row._id),
      reference: row.receiptReference,
      paymentReference: row.reference,
      amountMinor: row.amountMinor,
      amountLabel: moneyLabel(row.amountMinor),
      method: row.method,
      paidAt: row.paidAt.toISOString(),
      status: 'settled' as const,
    })),
  };
}
export async function readStudentFees(scope: StudentReadScope) {
  const rows = await FeeObligation.find({
    branchId: scope.branchId,
    studentId: scope.student._id,
    recipientUserId: scope.actor._id,
  })
    .sort({ createdAt: -1 })
    .limit(101)
    .read('primary')
    .lean();
  if (rows.length > 100) {
    throw new RequestContractError(
      409,
      'Fee history requires a paginated statement',
    );
  }
  return {
    items: await Promise.all(rows.map(row => feeDTO(row))),
    legacyUnmigratedCount: await LegacyFee.countDocuments({})
      .where('branchId')
      .equals(scope.branchId)
      .where('studentId')
      .equals(scope.student._id),
    currency: 'PKR' as const,
    onlinePayments: {
      enabled: false,
      message: 'Online payments unavailable — provider validation pending',
    },
  };
}
export async function createFeeStructure(
  identity: JwtPayload | undefined,
  token: string,
  body: unknown,
) {
  const input = objectBody(body, ['title', 'amountMinor', 'operationId']);
  const title = textField(input.title, 'title', 160, 2),
    amountMinor = safeMinor(input.amountMinor),
    op = operationKey(input.operationId),
    hash = fingerprint(['structure', title, amountMinor]);
  return financeWrite(
    identity,
    token,
    PERMISSIONS.FEE_MANAGE,
    async (ctx, session) => {
      const prior = await priorOperation(
        ctx.branchId,
        ctx.actor._id,
        op,
        hash,
        session,
      );
      if (prior) {
        return FeeStructure.findById(prior.targetId)
          .session(session)
          .select('_id title amountMinor currency')
          .lean();
      }
      const [row] = await FeeStructure.create(
        [
          {
            branchId: ctx.branchId,
            title,
            titleKey: title.toLowerCase(),
            amountMinor,
            currency: 'PKR',
            createdBy: ctx.actor._id,
          },
        ],
        { session },
      );
      await audit(
        ctx.branchId,
        ctx.actor._id,
        op,
        'structure.created',
        hash,
        row!._id,
        session,
        { amountMinor },
      );
      return { _id: row!._id, title, amountMinor, currency: 'PKR' };
    },
  );
}
export async function assignFee(
  identity: JwtPayload | undefined,
  token: string,
  body: unknown,
) {
  const input = objectBody(body, [
    'studentId',
    'structureId',
    'dueDate',
    'operationId',
  ]);
  const studentId = objectIdField(input.studentId, 'Student ID'),
    structureId = objectIdField(input.structureId, 'structure ID'),
    dueDate = scheduleDate(input.dueDate),
    op = operationKey(input.operationId),
    hash = fingerprint(['assign', studentId, structureId, dueDate]);
  return financeWrite(
    identity,
    token,
    PERMISSIONS.FEE_MANAGE,
    async (ctx, session) => {
      const prior = await priorOperation(
        ctx.branchId,
        ctx.actor._id,
        op,
        hash,
        session,
      );
      if (prior) {
        return feeDTO(
          await feeRecord(ctx.branchId, String(prior.targetId), session),
          session,
        );
      }
      const student = await Student.findOne({ isActive: true })
        .where('_id')
        .equals(studentId)
        .where('branchId')
        .equals(ctx.branchId)
        .session(session)
        .lean();
      if (!student) {
        throw financialDenied();
      }
      await Student.collection.updateOne(
        { _id: student._id },
        { $inc: { __v: 1 } },
        { session },
      );
      await User.collection.updateOne(
        { _id: new Types.ObjectId(String(student.userId)) },
        { $inc: { __v: 1 } },
        { session },
      );
      const scope = await resolveStudentReadScope(
        String(student.userId),
        ctx.branchId,
      );
      await StudentEnrollment.collection.updateOne(
        { _id: scope.enrollment._id },
        { $inc: { __v: 1 } },
        { session },
      );
      const structure = await FeeStructure.findOne({
        _id: structureId,
        branchId: ctx.branchId,
      })
        .session(session)
        .lean();
      if (!structure) {
        throw financialDenied();
      }
      const id = new Types.ObjectId();
      await FeeObligation.create(
        [
          {
            _id: id,
            branchId: ctx.branchId,
            studentId: student._id,
            recipientUserId: String(student.userId),
            enrollmentId: scope.enrollment._id,
            academicPeriodId: scope.enrollment.academicPeriodId,
            structureId: structure._id,
            title: structure.title,
            academicPeriodName: scope.period.name,
            amountMinor: structure.amountMinor,
            currency: structure.currency,
            dueDate,
            challanReference: `CH-${id}`,
            createdBy: ctx.actor._id,
          },
        ],
        { session },
      );
      await audit(
        ctx.branchId,
        ctx.actor._id,
        op,
        'fee.assigned',
        hash,
        id,
        session,
        { amountMinor: structure.amountMinor, reference: `CH-${id}` },
      );
      return feeDTO(
        await feeRecord(ctx.branchId, String(id), session),
        session,
      );
    },
  );
}
export async function branchFinanceSummary(
  branchId: string,
  academicYear?: string,
) {
  // Legacy year labels are not an enrollment/period authority. Callers may not select them.
  if (academicYear) {
    throw new RequestContractError(
      400,
      'Use canonical period scope instead of legacy academic year',
    );
  }
  const rows = await FeeObligation.aggregate([
    { $match: { branchId: new Types.ObjectId(branchId) } },
    {
      $lookup: {
        from: FinanceTransaction.collection.name,
        let: { fee: '$_id' },
        pipeline: [
          {
            $match: {
              branchId: new Types.ObjectId(branchId),
              state: 'settled',
              $expr: { $eq: ['$obligationId', '$$fee'] },
            },
          },
          { $group: { _id: null, paid: { $sum: '$amountMinor' } } },
        ],
        as: 'payments',
      },
    },
    {
      $set: { paid: { $ifNull: [{ $arrayElemAt: ['$payments.paid', 0] }, 0] } },
    },
    {
      $group: {
        _id: null,
        totalInvoices: { $sum: 1 },
        amountMinor: { $sum: '$amountMinor' },
        paidMinor: { $sum: '$paid' },
        paidInvoices: {
          $sum: { $cond: [{ $eq: ['$amountMinor', '$paid'] }, 1, 0] },
        },
        partialInvoices: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ['$paid', 0] },
                  { $lt: ['$paid', '$amountMinor'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        overdueInvoices: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lt: ['$dueDate', schoolToday()] },
                  { $lt: ['$paid', '$amountMinor'] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]).read('primary');
  const total = rows[0] ?? {
    totalInvoices: 0,
    amountMinor: 0,
    paidMinor: 0,
    paidInvoices: 0,
    partialInvoices: 0,
    overdueInvoices: 0,
  };
  const balanceMinor = total.amountMinor - total.paidMinor;
  const legacyUnmigratedCount = await LegacyFee.countDocuments({})
    .where('branchId')
    .equals(branchId);
  return {
    ...total,
    balanceMinor,
    amountLabel: moneyLabel(total.amountMinor),
    paidLabel: moneyLabel(total.paidMinor),
    balanceLabel: moneyLabel(balanceMinor),
    legacyUnmigratedCount,
  };
}
