import { Request, Response } from 'express';

import {
  createBranch,
  getAllBranches,
  getBranchById,
} from '../services/branch.service';

import { BranchScopedRequest } from '../middleware/branch.middleware';

export const createBranchController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { name, code, address, city, phone, email } = req.body;

    if (!name || !code || !address || !city) {
      res.status(400).json({
        success: false,
        message: 'Name, code, address and city are required',
      });
      return;
    }

    const branch = await createBranch({
      name,
      code,
      address,
      city,
      phone,
      email,
    });

    res.status(201).json({
      success: true,
      message: 'Branch created successfully',
      branch,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to create branch';

    res.status(400).json({
      success: false,
      message,
    });
  }
};

export const getBranches = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const branches = await getAllBranches();

    res.status(200).json({
      success: true,
      branches,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch branches',
    });
  }
};
export const getMyBranch = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const branch = await getBranchById(req.branchId);

    if (!branch) {
      res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      branch,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch branch',
    });
  }
};
