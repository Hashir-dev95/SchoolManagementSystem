import {ensureAttendanceAmendmentIndexes} from './models/attendanceAmendment';
import 'dotenv/config';
import {Syllabus} from './models/syllabus';
import {LessonPlan} from './models/lessonPlan';
import {LessonDelivery} from './models/lessonDelivery';
import {ensureAcademicWorkIndexes} from './services/academic-work.service';
import mongoose from 'mongoose';

import app from './app';
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

const PORT = process.env.PORT || 5000;

const startServer = async (): Promise<void> => {
  await connectDatabase();
  await ensureTeacherAccountIndex();
  await ensureAttendanceAmendmentIndexes();
  await ensureAssignmentAdminIndexes();
  await Promise.all([Syllabus.createIndexes(), LessonPlan.createIndexes(), LessonDelivery.createIndexes()]);
  await ensureAcademicWorkIndexes();
  // These new domain invariants must exist before accepting traffic, including
  // deployments with autoIndex disabled. Only the documented legacy issue index is replaced.
  await Promise.all([Subject.createIndexes(), TeacherAssignment.createIndexes(), ensureTimetableIndexes(), ensureAttendanceIndexes(), ensureTeacherNoticeIndexes(), AssignedWork.createIndexes(), Student.createIndexes(), SchoolNotice.createIndexes()]);

  const topology = await mongoose.connection.db!.admin().command({hello: 1});
  if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('Timetable mutations require a MongoDB replica set or sharded cluster');

  const PORT_NUM = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;

  if (isNaN(PORT_NUM)) {
    throw new Error('Invalid PORT');
  }

  app.listen(PORT_NUM, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();
