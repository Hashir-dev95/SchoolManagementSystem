import { Types } from 'mongoose';
import { CustodyPolicyRevision } from '../models/custodyPolicyRevision';
import { CustodyVerifierGrant } from '../models/custodyVerifierGrant';
import User from '../models/user';
import Session from '../models/session';

export type CustodyPolicyConfiguration = Readonly<{
  separationOfDuties: 'required' | 'not_configured';
  validityDays: number | null;
}>;

/** Strict product configuration parser. It validates structure only and never
 * establishes school approval or operational eligibility. */
export function parseCustodyPolicyConfiguration(raw: unknown): CustodyPolicyConfiguration | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['separationOfDuties', 'validityDays'].includes(key))) return null;
  if (value.separationOfDuties !== 'required' && value.separationOfDuties !== 'not_configured') return null;
  if (value.separationOfDuties === 'required' && (!Number.isSafeInteger(value.validityDays) || (value.validityDays as number) < 1 || (value.validityDays as number) > 3650)) return null;
  if (value.separationOfDuties === 'not_configured' && value.validityDays !== null) return null;
  return Object.freeze({ separationOfDuties: value.separationOfDuties, validityDays: value.validityDays as number | null });
}

export type CustodyVerifierDecision = { allowed: false; reason: 'policy_unapproved' | 'actor_unavailable' | 'session_unavailable' | 'grant_unavailable' | 'scope_mismatch' | 'grant_expired' | 'verification_not_implemented' };
const objectId = (value: string): Types.ObjectId | null => Types.ObjectId.isValid(value) && new Types.ObjectId(value).toHexString() === value.toLowerCase() ? new Types.ObjectId(value) : null;

/** Read-only fail-closed evaluator. No role alone grants authority, and even a
 * valid synthetic grant is not consumed by any verification or release writer. */
export async function evaluateCustodyVerifierGrant(input: {
  userId: string; branchId: string; scope: 'student_custody' | 'collector_identity';
  sessionId: string; now?: Date;
}): Promise<CustodyVerifierDecision> {
  const userId = objectId(input.userId), branchId = objectId(input.branchId), sessionId = objectId(input.sessionId);
  if (!userId || !branchId || !sessionId) return { allowed: false, reason: 'actor_unavailable' };
  const actor = await User.findById(userId).lean();
  if (!actor || !actor.isActive || !actor.branchId || String(actor.branchId) !== branchId.toHexString()) return { allowed: false, reason: 'actor_unavailable' };
  const login = await Session.findById(sessionId).lean();
  if (!login || login.isRevoked || String(login.userId) !== userId.toHexString() || login.role !== actor.role) return { allowed: false, reason: 'session_unavailable' };
  const grant = await CustodyVerifierGrant.findOne({ userId, branchId, scope: input.scope, status: 'active' }).lean();
  if (!grant) return { allowed: false, reason: 'grant_unavailable' };
  const now = input.now ?? new Date();
  if (grant.validFrom > now || grant.validUntil <= now) return { allowed: false, reason: 'grant_expired' };
  const policy = await CustodyPolicyRevision.findOne({ branchId, status: 'approved' }).lean();
  if (!policy) return { allowed: false, reason: 'policy_unapproved' };
  if (!parseCustodyPolicyConfiguration(policy.configuration)) return { allowed: false, reason: 'policy_unapproved' };
  return { allowed: false, reason: 'verification_not_implemented' };
}
