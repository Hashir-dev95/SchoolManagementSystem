import {NextFunction, Request, Response} from 'express';

import {verifyAccessToken, JwtPayload} from '../services/jwt.service';
import {isTokenRevoked} from '../services/session.service';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Access token is required',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decodedToken = verifyAccessToken(token);

    const revoked = await isTokenRevoked(token);
    if (revoked) {
      res.status(401).json({
        success: false,
        message: 'Session has been revoked',
      });
      return;
    }

    req.user = decodedToken;

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired access token',
    });
  }
};