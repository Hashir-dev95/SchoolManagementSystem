import 'dotenv/config';
import {once} from 'node:events';
import {ensureStaffSelfServiceIndexes} from './models/staffSelfService';
import {ensureLiveLessonIndexes} from './models/liveLessonSession';
import {liveLessonService} from './services/live-lesson.service';
import {ensureAttendanceAmendmentIndexes} from './models/attendanceAmendment';
import {Syllabus} from './models/syllabus';
import {LessonPlan} from './models/lessonPlan';
import {LessonDelivery} from './models/lessonDelivery';
import {ensureAcademicWorkIndexes} from './services/academic-work.service';
import {ensureAcademicEvidenceIndexes} from './services/academic-evidence.service';
import {ensureCatchUpIndexes} from './services/catch-up.service';
import {ensureAcademicResultIndexes} from './services/academic-result.service';
import {ensureTeacherNotificationIndexes} from './services/teacher-notification.service';
import mongoose from 'mongoose';
import {ensureAcademicSetupIndexes} from './services/academic-setup.service';

import app from './app';
import {ensureFinanceIndexes} from './models/finance';
import connectDatabase from './config/database';
import Subject from './models/subject';
import TeacherAssignment from './models/teacherAssignment';
import {ensureTimetableIndexes} from './models/timetable';
import {ensureAttendanceIndexes} from './models/periodAttendance';
import {ensureTeacherNoticeIndexes} from './models/teacherNotice';
import {AssignedWork} from './models/assignedWork';
import Student from './models/student';
import SchoolNotice from './models/schoolNotice';
import {ensureTeacherAccountIndex} from './services/teacher-provisioning.service';
import {ensureAssignmentAdminIndexes} from './services/teacher-assignment-admin.service';
import {ensureChatIndexes} from './models/chat';
import {ensureParentLeaveApplicationIndexes} from './models/parentLeaveApplication';
import {ensureGateFoundationIndexes} from './models/gateFoundation';
import {ensurePickupAuthorizationIndexes} from './models/pickupAuthorization';

class StartupError extends Error {}
const configuredPort = process.env.PORT || '5000';
const port = Number(configuredPort);
let startupStep = 'validating configuration';

const startServer = async (): Promise<void> => {
  if (!/^\d+$/.test(configuredPort) || port < 1 || port > 65535) {
    throw new StartupError('PORT must be an integer between 1 and 65535.');
  }
  if (!process.env.MONGODB_URI) {
    throw new StartupError('Set MONGODB_URI in backend/.env or the process environment.');
  }
  if (!process.env.JWT_SECRET) {
    throw new StartupError('Set JWT_SECRET in backend/.env or the process environment.');
  }

  startupStep = 'connecting to MongoDB';
  await connectDatabase();

  startupStep = 'checking MongoDB topology';
  const topology = await mongoose.connection.db!.admin().command({hello: 1});
  if (!topology.setName && topology.msg !== 'isdbgrid') {
    throw new StartupError('HIRA transactions require a MongoDB replica set or sharded cluster.');
  }

  startupStep = 'initializing required database indexes';
  await ensureFinanceIndexes();
  await ensureAcademicSetupIndexes();
  await ensureStaffSelfServiceIndexes();
  await ensureParentLeaveApplicationIndexes();
  await ensureGateFoundationIndexes();
  await ensurePickupAuthorizationIndexes();
  await ensureLiveLessonIndexes();
  await ensureTeacherAccountIndex();
  await ensureAttendanceAmendmentIndexes();
  await ensureAssignmentAdminIndexes();
  await Promise.all([Syllabus.createIndexes(), LessonPlan.createIndexes(), LessonDelivery.createIndexes()]);
  await ensureAcademicWorkIndexes();
  await ensureAcademicEvidenceIndexes();
  await ensureCatchUpIndexes();
  await ensureAcademicResultIndexes();
  await ensureTeacherNotificationIndexes();
  await ensureChatIndexes();
  // These new domain invariants must exist before accepting traffic, including
  // deployments with autoIndex disabled. Only the documented legacy issue index is replaced.
  await Promise.all([Subject.createIndexes(), TeacherAssignment.createIndexes(), ensureTimetableIndexes(), ensureAttendanceIndexes(), ensureTeacherNoticeIndexes(), AssignedWork.createIndexes(), Student.createIndexes(), SchoolNotice.createIndexes()]);

  console.log('Required database indexes initialized');

  startupStep = 'binding the HTTP listener';
  const server = app.listen(port, '0.0.0.0');
  await once(server, 'listening');
  console.log(`Backend server listening on port ${port}`);

  let classroomMaintenance = false;
  const classroomTimer = setInterval(() => {
    if (classroomMaintenance) return;
    classroomMaintenance = true;
    liveLessonService.maintainClassrooms().catch(() => {
      console.warn(JSON.stringify({operation: 'live.classroom.maintenance', category: 'unavailable'}));
    }).finally(() => { classroomMaintenance = false; });
  }, 10000);
  classroomTimer.unref();
};

startServer().catch(async (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  let detail = typeof code === 'number' ? `MongoDB error code ${code}.` : '';
  if (error instanceof StartupError) detail = error.message;
  else if (code === 'EADDRINUSE') detail = `Port ${port} is already in use (EADDRINUSE).`;
  else if (code === 'EACCES' && startupStep === 'binding the HTTP listener') detail = `Permission denied for port ${port} (EACCES).`;
  else if (startupStep === 'connecting to MongoDB' && !detail) {
    detail = 'Check MONGODB_URI, database access, and network connectivity.';
  }
  // Driver error messages can include connection strings and index key values.
  console.error(`[startup] Failed while ${startupStep}.${detail ? ` ${detail}` : ''}`);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => console.error('[startup] MongoDB cleanup failed.'));
});
