import { once } from 'node:events';
import mongoose from 'mongoose';
import Branch from '../../src/models/branch';
import type { JwtPayload } from '../../src/services/jwt.service';
import { readGateAssignment } from '../../src/services/gate-authority.service';
import {
  assignGateOperator,
  revokeGateAssignment,
  updateStudentCustody,
} from '../../src/services/gate-administration.service';

export interface GateWorkerInput {
  uri: string;
  dbName: string;
  identity: JwtPayload;
  token: string;
  branchId: string;
  gateId: string;
  assignmentId: string;
  studentId: string;
  action: 'context' | 'assign' | 'revoke' | 'custody';
  hold: boolean;
  payload: Record<string, unknown>;
}
process.once('message', async (input: GateWorkerInput) => {
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
    const result =
      input.action === 'context'
        ? await readGateAssignment(
            input.identity,
            input.token,
            input.gateId,
            input.assignmentId,
          )
        : input.action === 'assign'
        ? await assignGateOperator(
            input.identity,
            input.token,
            input.branchId,
            input.gateId,
            input.payload,
          )
        : input.action === 'revoke'
        ? await revokeGateAssignment(
            input.identity,
            input.token,
            input.branchId,
            input.assignmentId,
            input.payload,
          )
        : await updateStudentCustody(
            input.identity,
            input.token,
            input.branchId,
            input.studentId,
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
