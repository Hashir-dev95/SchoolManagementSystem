import { once } from 'node:events';
import mongoose from 'mongoose';
import Branch from '../../src/models/branch';
import type { JwtPayload } from '../../src/services/jwt.service';
import {
  writeParentExit,
  decideEarlyExit,
  type ExitAction,
} from '../../src/services/early-exit-write.service';
export interface EarlyExitWorkerInput {
  uri: string;
  dbName: string;
  identity: JwtPayload;
  token: string;
  branchId: string;
  studentId: string;
  requestId: string;
  approvalId: string;
  action: ExitAction | 'decide';
  payload: Record<string, unknown>;
  hold: boolean;
}
process.once('message', async (input: EarlyExitWorkerInput) => {
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
      input.action === 'decide'
        ? await decideEarlyExit(
            input.identity,
            input.token,
            input.approvalId,
            input.payload,
          )
        : await writeParentExit(
            input.action,
            input.identity,
            input.token,
            input.studentId,
            input.requestId || undefined,
            input.payload,
          );
    process.send?.({ event: 'result', status: 200, result });
  } catch (error) {
    process.send?.({
      event: 'result',
      status: (error as { status?: number }).status ?? 500,
    });
  } finally {
    await mongoose.disconnect();
    process.disconnect?.();
  }
});
