import { once } from 'node:events';
import mongoose from 'mongoose';
import Branch from '../../src/models/branch';
import type { JwtPayload } from '../../src/services/jwt.service';
import {
  writeParentPickup,
  type ParentPickupAction,
} from '../../src/services/pickup-authorization-write.service';
import { decidePickup } from '../../src/services/pickup-authorization-review.service';
import { updateStudentCustody } from '../../src/services/gate-administration.service';

export interface PickupWorkerInput {
  uri: string;
  dbName: string;
  identity: JwtPayload;
  token: string;
  branchId: string;
  studentId: string;
  authorizationId: string;
  approvalId: string;
  action: ParentPickupAction | 'decide' | 'hold';
  payload: Record<string, unknown>;
  hold: boolean;
}
process.once('message', async (input: PickupWorkerInput) => {
  try {
    await mongoose.connect(input.uri, {
      dbName: input.dbName,
      autoIndex: false,
    });
    const update = Branch.collection.updateOne.bind(Branch.collection);
    let attempted = false;
    Branch.collection.updateOne = async (
      ...args: Parameters<typeof update>
    ) => {
      const first = !attempted && args[2]?.session?.inTransaction();
      if (first) {
        attempted = true;
        process.send?.({ event: 'attempting' });
      }
      const result = await update(...args);
      if (first && input.hold && result.matchedCount) {
        const release = once(process, 'message');
        process.send?.({ event: 'locked' });
        await release;
      }
      return result;
    };
    if (input.action === 'hold')
      process.env.GATE_ADMIN_BRANCH_IDS = JSON.stringify([input.branchId]);
    const result =
      input.action === 'decide'
        ? await decidePickup(
            input.identity,
            input.token,
            input.approvalId,
            input.payload,
          )
        : input.action === 'hold'
        ? await updateStudentCustody(
            input.identity,
            input.token,
            input.branchId,
            input.studentId,
            input.payload,
          )
        : await writeParentPickup(
            input.action,
            input.identity,
            input.token,
            input.studentId,
            input.authorizationId || undefined,
            input.payload,
          );
    process.send?.({ event: 'result', status: 200, result });
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
});
