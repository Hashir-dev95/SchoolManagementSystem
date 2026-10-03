import { Request, Response } from 'express';
import { generateAccessToken } from '../services/jwt.service';
import { authenticateUser, createUser } from '../services/auth.service';
import User, { UserRole } from '../models/user';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, phone, password, role, branchId } = req.body;

    if (!fullName || !email || !password || !role) {
      res.status(400).json({
        success: false,
        message: 'Full name, email, password and role are required',
      });
      return;
    }

    const user = await createUser({
      fullName,
      email,
      phone,
      password,
      role: role as UserRole,
      branchId,
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        branchId: user.branchId,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Registration failed';

    res.status(400).json({
      success: false,
      message,
    });
  }
};

export const getCurrentUser = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
      return;
    }

    const user = await User.findById(req.user.userId).select('-password');

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch current user',
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
      return;
    }

    const user = await authenticateUser(email, password);
    const accessToken = generateAccessToken(user._id.toString(), user.role);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      accessToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        branchId: user.branchId,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';

    res.status(401).json({
      success: false,
      message,
    });
  }
};
export const rbacTest = (
  _req: AuthenticatedRequest,
  res: Response,
): void => {
  res.status(200).json({
    success: true,
    message: 'RBAC access granted',
  });
};
