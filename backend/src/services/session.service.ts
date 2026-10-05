import {Types} from 'mongoose';
import Session, {ISession} from '../models/session';

export const registerSession = async (
  userId: string,
  token: string,
  role: string,
): Promise<ISession> => {
  const session = new Session({
    userId: new Types.ObjectId(userId),
    token,
    role,
    isRevoked: false,
  });

  await session.save();

  return session;
};

export const isTokenRevoked = async (token: string): Promise<boolean> => {
  const session = await Session.findOne({token});

  if (session && session.isRevoked) {
    return true;
  }

  return false;
};

export const getSessions = async (): Promise<ISession[]> => {
  return Session.find()
    .populate('userId', 'fullName email role')
    .sort({createdAt: -1});
};

export const revokeSession = async (
  sessionId: string,
  revokedBy: string,
): Promise<ISession> => {
  if (!Types.ObjectId.isValid(sessionId)) {
    throw new Error('Invalid session ID');
  }

  if (!Types.ObjectId.isValid(revokedBy)) {
    throw new Error('Invalid reviewer ID');
  }

  const session = await Session.findById(sessionId);

  if (!session) {
    throw new Error('Session not found');
  }

  if (session.isRevoked) {
    throw new Error('Session is already revoked');
  }

  session.isRevoked = true;
  session.revokedAt = new Date();
  session.revokedBy = new Types.ObjectId(revokedBy);

  await session.save();

  return session;
};
