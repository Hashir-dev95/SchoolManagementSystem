import {Router, type Response} from 'express';
import {authenticateToken, type AuthenticatedRequest} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {PERMISSIONS} from '../constants/permissions';
import {RequestContractError, objectBody} from '../utils/request-validation';
import {readSetup, writeSetup, setupBranches, type SetupKind} from '../services/academic-setup.service';

const handle = (action: (request: AuthenticatedRequest) => Promise<unknown>, status = 200) => async (request: AuthenticatedRequest, response: Response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (request.method === 'GET' && request.body !== undefined) throw new RequestContractError(400, 'Unsupported request body');
    response.status(status).json({success: true, data: await action(request)});
  } catch (error) {
    response.status(error instanceof RequestContractError ? error.status : 500).json({success: false, message: error instanceof RequestContractError ? error.message : 'Academic setup operation failed. Please retry.'});
  }
};
export const academicSetupRouter = Router();
academicSetupRouter.use(authenticateToken, requireRole('principal', 'super_admin'));
academicSetupRouter.get('/branches', requirePermission(PERMISSIONS.ACADEMIC_PERIODS_VIEW), handle(request => {objectBody(request.query, []); return setupBranches(request.user);}));
for (const kind of ['periods', 'classes', 'sections', 'subjects'] as SetupKind[]) {
  const grants = {
    periods: [PERMISSIONS.ACADEMIC_PERIODS_VIEW, PERMISSIONS.ACADEMIC_PERIODS_MANAGE],
    classes: [PERMISSIONS.ACADEMIC_CLASSES_VIEW, PERMISSIONS.ACADEMIC_CLASSES_MANAGE],
    sections: [PERMISSIONS.ACADEMIC_SECTIONS_VIEW, PERMISSIONS.ACADEMIC_SECTIONS_MANAGE],
    subjects: [PERMISSIONS.ACADEMIC_SUBJECTS_VIEW, PERMISSIONS.ACADEMIC_SUBJECTS_MANAGE],
  } as const;
  const view = requirePermission(grants[kind][0]), manage = requirePermission(grants[kind][1]);
  academicSetupRouter.get(`/${kind}`, view, handle(request => readSetup(request.user, kind, request.query)));
  academicSetupRouter.get(`/${kind}/:id`, view, handle(request => readSetup(request.user, kind, request.query, request.params.id)));
  const write = (action: Parameters<typeof writeSetup>[4]) => (request: AuthenticatedRequest) => {
    const query = objectBody(request.query, ['branchId']);
    return writeSetup(request.user, request.headers.authorization!.slice(7), kind, query.branchId, action, request.params.id, request.body);
  };
  academicSetupRouter.post(`/${kind}`, manage, handle(write('create'), 201));
  academicSetupRouter.patch(`/${kind}/:id`, manage, handle(write('update')));
  for (const action of kind === 'periods' ? ['activate', 'close', 'archive'] as const : ['deactivate', 'reactivate'] as const) academicSetupRouter.post(`/${kind}/:id/${action}`, manage, handle(write(action)));
}
