import attendanceAmendmentRoutes from './routes/attendance-amendment.routes';
import {academicAdminRouter, teacherAcademicRouter} from './routes/academic.routes';
import express, {ErrorRequestHandler} from 'express';
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
import teacherRoutes from './routes/teacher.routes';
import teacherHomeRoutes from './routes/teacher-home.routes';
import {teacherCommunicationRouter, assignedWorkManagementRouter} from './routes/teacher-communication.routes';
import teacherAttendanceRoutes from './routes/teacher-attendance.routes';
import {teacherTimetableRouter, timetableAdminRouter} from './routes/timetable.routes';
import teacherAssignmentRoutes from './routes/teacher-assignment.routes';

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
// Sanitize bootstrap JSON parser errors: Express's default development error
// response can include the submitted credential body and a stack trace.
const bootstrapParseError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({success: false, message: 'Invalid bootstrap request'});
    return;
  }
  next(error);
};
app.use('/api/bootstrap', bootstrapParseError);
app.use('/api/usage', usageRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/privileged-requests', privilegedRequestRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/approval-requests', approvalRequestRoutes);
app.use('/api', attendanceAmendmentRoutes);
app.use('/api/teacher/home', teacherHomeRoutes);
app.use('/api/syllabuses', academicAdminRouter);
app.use('/api/teacher/academic', teacherAcademicRouter);
app.use('/api/teacher/timetable', teacherTimetableRouter);
app.use('/api/teacher/attendance', teacherAttendanceRoutes);
app.use('/api/timetables', timetableAdminRouter);
app.use('/api/teacher', teacherCommunicationRouter);
app.use('/api/assigned-work', assignedWorkManagementRouter);
app.use('/api/teacher', teacherRoutes);
app.use('/api/teacher-assignments', teacherAssignmentRoutes);

const teacherParseError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    res.status(400).json({success: false, message: 'Invalid Teacher request body'});
    return;
  }
  next(error);
};
app.use('/api/teacher', teacherParseError);
app.use('/api/syllabuses', teacherParseError);
app.use('/api/assigned-work', teacherParseError);
app.use('/api/timetables', teacherParseError);
app.use('/api/teacher-assignments', teacherParseError);

// Credential parser errors must not echo submitted JSON or parser details.
const teacherAccountParseError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    res.status(400).json({success: false, message: 'Invalid Teacher account request body'});
    return;
  }
  next(error);
};
app.use('/api/admin/teachers', teacherAccountParseError);

// Scope parser failures to Principal APIs; leave bootstrap and other API error
// behavior unchanged. Never echo submitted JSON or the parser's stack/message.
const principalParseError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    res.status(400).json({
      success: false, message: 'Invalid Principal request body',
    });
    return;
  }
  next(error);
};
app.use('/api/principal', principalParseError);
app.use('/api/approval-requests', principalParseError);

export default app;
