import mongoose from 'mongoose';
import { once } from 'node:events';
import Branch from '../../src/models/branch';
import { decideParentLeave } from '../../src/services/parent-leave-review.service';
import { changeParentLeaveLifecycle } from '../../src/services/parent-leave-lifecycle.service';
import { resubmitParentLeave } from '../../src/services/parent-leave-resubmission.service';
import { requestAttendanceAmendment } from '../../src/services/attendance-amendment.service';

export interface DecisionWorkerInput {
  uri: string;
  dbName: string;
  approvalId: string;
  applicationId: string;
  studentId: string;
  token: string;
  userId: string;
  branchId: string;
  action:
    | 'approve'
    | 'reject'
    | 'withdraw'
    | 'request_changes'
    | 'resubmit'
    | 'submit'
    | 'teacher_leave';
  operationId: string;
  hold: boolean;
  payload?: Record<string, unknown>;
}

async function run(input: DecisionWorkerInput) {
  await mongoose.connect(input.uri, { dbName: input.dbName, autoIndex: false });
  try {
    const update = Branch.collection.updateOne.bind(Branch.collection);
    let attempted = false;
    Branch.collection.updateOne = async (
      ...args: Parameters<typeof update>
    ) => {
      const firstAttempt = !attempted && args[2]?.session?.inTransaction();
      if (firstAttempt) {
        attempted = true;
        process.send?.({ event: 'attempting' });
      }
      const result = await update(...args);
      if (input.hold && firstAttempt && result.matchedCount) {
        const released = once(process, 'message');
        process.send?.({ event: 'locked' });
        await released;
      }
      return result;
    };
    const result =
      input.action === 'resubmit'
        ? await resubmitParentLeave(
            { userId: input.userId, role: 'parent' },
            input.token,
            input.studentId,
            input.applicationId,
            { ...input.payload, clientOperationId: input.operationId },
          )
        : input.action === 'teacher_leave'
        ? await requestAttendanceAmendment(
            { userId: input.userId, role: 'teacher' },
            input.token,
            'leave',
            input.applicationId,
            input.studentId,
            { ...input.payload, clientOperationId: input.operationId },
          )
        : input.action === 'withdraw' || input.action === 'submit'
        ? await changeParentLeaveLifecycle(
            input.action,
            { userId: input.userId, role: 'parent' },
            input.token,
            input.studentId,
            input.applicationId,
            {
              revision: input.action === 'withdraw' ? 1 : 0,
              clientOperationId: input.operationId,
            },
          )
        : await decideParentLeave(
            {
              actorId: input.userId,
              branchId: input.branchId,
              token: input.token,
            },
            input.approvalId,
            {
              action: input.action,
              applicationRevision: 1,
              approvalVersion: 0,
              clientOperationId: input.operationId,
              ...(input.action !== 'approve'
                ? {
                    decisionReason:
                      'The requested dates could not be approved.',
                  }
                : {}),
            },
          );
    process.send?.({ event: 'result', status: 200, replayed: result.replayed });
  } catch (error) {
    process.send?.({
      event: 'result',
      status: (error as { status?: number }).status ?? 500,
      message: (error as Error).message,
    });
  } finally {
    await mongoose.disconnect();
    process.disconnect?.();
  }
}

run(
  JSON.parse(process.env.G3B_WORKER_INPUT ?? '') as DecisionWorkerInput,
).catch(error => {
  console.error(error);
  process.exitCode = 1;
  process.disconnect?.();
});
