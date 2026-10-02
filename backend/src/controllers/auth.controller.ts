import {Request, Response} from 'express';

import {
  authenticateUser,
  createUser,
} from '../services/auth.service';
import {UserRole} from '../models/user';

export const register = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {
      fullName,
      email,
      phone,
      password,
      role,
      branchId,
    } = req.body;

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

export const login = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {email, password} = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
      return;
    }

    const user = await authenticateUser(email, password);

    res.status(200).json({
      success: true,
      message: 'Login successful',
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
      error instanceof Error ? error.message : 'Login failed';

    res.status(401).json({
      success: false,
      message,
    });
  }
};