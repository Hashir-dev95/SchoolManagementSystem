import express from 'express';
import cors from 'cors';
import branchRoutes from './routes/branch.routes';
import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import principalRoutes from './routes/principal.routes';
import bootstrapRoutes from './routes/bootstrap.routes';
import approvalRequestRoutes from './routes/approval-request.routes';

import healthRoutes from './routes/health.routes';
import * as backupRoutesModule from './routes/backup.routes';
import usageRoutes from './routes/usage.routes';
import privilegedRequestRoutes from './routes/privileged-request.routes';
import automationRoutes from './routes/automation.routes';
import sessionRoutes from './routes/session.routes';

const backupRoutes = (backupRoutesModule as any).default ?? backupRoutesModule;

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'School Management System API is running',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/principal', principalRoutes);
app.use('/api/bootstrap', bootstrapRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/privileged-requests', privilegedRequestRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/approval-requests', approvalRequestRoutes);

export default app;