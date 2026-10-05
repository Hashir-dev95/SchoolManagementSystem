import { Request, Response } from 'express';
import { createUser } from '../services/auth.service';

export const bootstrapSuperAdmin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { fullName, email, password, phone } = req.body;

    if (!fullName || !email || !password) {
      res.status(400).json({
        success: false,
        message: 'Full name, email and password are required',
      });
      return;
    }

    const user = await createUser({
      fullName,
      email,
      password,
      phone,
      role: 'super_admin',
    });

    res.status(201).json({
      success: true,
      message: 'Super Admin created successfully',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to create Super Admin';

    res.status(400).json({
      success: false,
      message,
    });
  }
};
