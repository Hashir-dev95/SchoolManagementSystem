const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');
const { createClassTeacherApplication } = require('./applicationService');
const { createUserNotificationRouter } = require('./userNotificationRoutes');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
});

function requireStudentContext(req, res, next) {
  const userId = typeof req.user?.id === 'string' ? req.user.id.trim() : '';
  if (!userId) {
    return res
      .status(401)
      .json({ success: false, error: 'Trusted user context is required.' });
  }
  if (req.user.role !== 'student') {
    return res
      .status(403)
      .json({ success: false, error: 'Student access is required.' });
  }
  getDatabase()
    .collection('students')
    .findOne({ userId })
    .then(student => {
      if (!student || !student.id) {
        return res.status(403).json({
          success: false,
          error: 'No student record is linked to this user.',
        });
      }
      req.studentRecord = student;
      return next();
    })
    .catch(next);
}

function dateFilter(query, field) {
  const from = typeof query.from === 'string' ? query.from : '';
  const to = typeof query.to === 'string' ? query.to : '';
  const valid = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  };
  if ((from && !valid(from)) || (to && !valid(to)))
    return { error: 'from and to must be valid YYYY-MM-DD dates.' };
  if (from && to && from > to)
    return { error: 'from must be on or before to.' };
  if (!from && !to) return { filter: {} };
  const lower = from
    ? new Date(`${from}T00:00:00.000Z`)
    : new Date('1970-01-01T00:00:00.000Z');
  const upper = to ? new Date(`${to}T00:00:00.000Z`) : null;
  if (upper) upper.setUTCDate(upper.getUTCDate() + 1);
  return {
    filter: { [field]: { $gte: lower, ...(upper ? { $lt: upper } : {}) } },
  };
}

function studentClassFilter(student) {
  const scope = [{ studentId: student.id }];
  scope.push({ studentIds: student.id });
  if (student.classId) scope.push({ classId: student.classId });
  return { $or: scope };
}

function publishedFilter() {
  return { $or: [{ published: true }, { status: 'published' }] };
}

function recordIdFilter(id) {
  const alternatives = [{ id }];
  if (ObjectId.isValid(id)) alternatives.push({ _id: new ObjectId(id) });
  return { $or: alternatives };
}

function submissionDeadline(value) {
  if (value == null || value === '') return { deadline: null };
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? { deadline: value }
      : { error: 'Homework has an invalid deadline.' };
  }
  if (typeof value !== 'string') {
    return { error: 'Homework has an invalid deadline.' };
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const midnight = new Date(Date.UTC(year, month - 1, day));
    if (
      midnight.getUTCFullYear() !== year ||
      midnight.getUTCMonth() !== month - 1 ||
      midnight.getUTCDate() !== day
    ) {
      return { error: 'Homework has an invalid deadline.' };
    }
    midnight.setUTCHours(23, 59, 59, 999);
    return { deadline: midnight };
  }
  const deadline = new Date(value);
  return Number.isFinite(deadline.getTime())
    ? { deadline }
    : { error: 'Homework has an invalid deadline.' };
}

router.use(requireStudentContext);
router.use('/notifications', createUserNotificationRouter('student'));

router.get('/applications', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('classTeacherApplications')
      .find(
        {
          applicantUserId: req.user.id,
          applicantRole: 'student',
          studentId: req.studentRecord.id,
        },
        { projection: { applicantUserId: 0, assignedTeacherUserId: 0 } },
      )
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/applications', async (req, res, next) => {
  try {
    const result = await createClassTeacherApplication({
      input: req.body,
      applicant: req.user,
      student: req.studentRecord,
      applicantRole: 'student',
    });
    if (result.error) {
      return res
        .status(result.statusCode)
        .json({ success: false, error: result.error });
    }
    return res
      .status(result.statusCode)
      .json({ success: true, data: result.data });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const profile = await getDatabase()
      .collection('students')
      .findOne(
        { _id: req.studentRecord._id },
        {
          projection: {
            _id: 0,
            id: 1,
            name: 1,
            fullName: 1,
            email: 1,
            grade: 1,
            section: 1,
            classId: 1,
            branchId: 1,
            attendance: 1,
            status: 1,
          },
        },
      );
    return res.json({ success: true, data: profile });
  } catch (error) {
    return next(error);
  }
});

router.get('/timetable', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('timetable')
      .find(studentClassFilter(req.studentRecord))
      .sort({ dayOfWeek: 1, startTime: 1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/attendance', async (req, res, next) => {
  try {
    const range = dateFilter(req.query, 'date');
    if (range.error)
      return res.status(400).json({ success: false, error: range.error });
    const data = await getDatabase()
      .collection('attendance')
      .find({ studentId: req.studentRecord.id, ...range.filter })
      .sort({ date: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/results', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('results')
      .find({ studentId: req.studentRecord.id, ...publishedFilter() })
      .sort({ publishedAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/progress', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('progress')
      .find({ studentId: req.studentRecord.id })
      .sort({ updatedAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/homework', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('homework')
      .aggregate([
        {
          $match: {
            $and: [publishedFilter(), studentClassFilter(req.studentRecord)],
          },
        },
        {
          $lookup: {
            from: 'submissions',
            let: { homeworkId: { $ifNull: ['$id', { $toString: '$_id' }] } },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$homeworkId', '$$homeworkId'] },
                      { $eq: ['$studentId', req.studentRecord.id] },
                    ],
                  },
                },
              },
              { $sort: { submittedAt: -1 } },
              { $limit: 1 },
              { $project: { fileData: 0 } },
            ],
            as: 'studentSubmissions',
          },
        },
        { $addFields: { latestSubmission: { $first: '$studentSubmissions' } } },
        { $project: { studentSubmissions: 0 } },
        { $sort: { dueDate: 1 } },
      ])
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/homework/:homeworkId/submissions', async (req, res, next) => {
  try {
    const db = getDatabase();
    const homework = await db.collection('homework').findOne({
      $and: [
        recordIdFilter(req.params.homeworkId),
        publishedFilter(),
        studentClassFilter(req.studentRecord),
      ],
    });
    if (!homework) {
      return res.status(404).json({
        success: false,
        error: 'Published homework was not found for this student.',
      });
    }
    const data = await db
      .collection('submissions')
      .find(
        {
          homeworkId: homework.id || String(homework._id),
          studentId: req.studentRecord.id,
        },
        { projection: { fileData: 0 } },
      )
      .sort({ submittedAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/submissions/:submissionId/file', async (req, res, next) => {
  try {
    const submission = await getDatabase().collection('submissions').findOne({
      id: req.params.submissionId,
      studentId: req.studentRecord.id,
    });
    if (!submission || !submission.fileData) {
      return res
        .status(404)
        .json({ success: false, error: 'Submission file was not found.' });
    }
    res.setHeader('Content-Type', submission.contentType);
    const downloadName = path
      .basename(String(submission.fileName || 'submission').replace(/\\/g, '/'))
      .replace(/[\r\n\0"]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadName}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(
      Buffer.isBuffer(submission.fileData)
        ? submission.fileData
        : submission.fileData.buffer,
    );
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/homework/:homeworkId/submissions',
  upload.single('file'),
  async (req, res, next) => {
    try {
      const db = getDatabase();
      const homework = await db.collection('homework').findOne({
        $and: [
          recordIdFilter(req.params.homeworkId),
          publishedFilter(),
          studentClassFilter(req.studentRecord),
        ],
      });
      if (!homework)
        return res.status(404).json({
          success: false,
          error: 'Published homework was not found for this student.',
        });
      const textProvided = req.body.text !== undefined;
      if (textProvided && typeof req.body.text !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Submission text must be plain text.',
        });
      }
      const submissionText = textProvided ? req.body.text.trim() : '';
      if (submissionText.length > 10000) {
        return res.status(400).json({
          success: false,
          error: 'Submission text must be 10,000 characters or fewer.',
        });
      }
      if (!req.file && !submissionText) {
        return res.status(400).json({
          success: false,
          error:
            'Provide submission text or attach one PDF, JPEG, or PNG file.',
        });
      }

      const { deadline, error: deadlineError } = submissionDeadline(
        homework.dueDate,
      );
      if (deadlineError) {
        return res.status(409).json({ success: false, error: deadlineError });
      }
      if (deadline && Date.now() > deadline.getTime()) {
        return res.status(409).json({
          success: false,
          error: 'The homework submission deadline has passed.',
        });
      }

      const homeworkId = homework.id || String(homework._id);
      const existingSubmission = await db.collection('submissions').findOne({
        homeworkId,
        studentId: req.studentRecord.id,
      });
      if (existingSubmission) {
        return res.status(409).json({
          success: false,
          error: 'A submission already exists for this homework.',
        });
      }

      let type = null;
      let safeFileName = null;
      if (req.file) {
        const allowed = {
          '.pdf': { mime: 'application/pdf', signature: Buffer.from('%PDF-') },
          '.jpg': {
            mime: 'image/jpeg',
            signature: Buffer.from([0xff, 0xd8, 0xff]),
          },
          '.jpeg': {
            mime: 'image/jpeg',
            signature: Buffer.from([0xff, 0xd8, 0xff]),
          },
          '.png': {
            mime: 'image/png',
            signature: Buffer.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ]),
          },
        };
        const extension = path.extname(req.file.originalname).toLowerCase();
        type = allowed[extension];
        if (
          !type ||
          req.file.mimetype !== type.mime ||
          !req.file.buffer
            .subarray(0, type.signature.length)
            .equals(type.signature)
        ) {
          return res.status(400).json({
            success: false,
            error:
              'File content, extension, and MIME type must match PDF, JPEG, or PNG.',
          });
        }
        safeFileName = path
          .basename(req.file.originalname.replace(/\\/g, '/'))
          .replace(/[\r\n\0"]/g, '_')
          .slice(0, 180);
      }

      const submission = {
        id: crypto.randomUUID(),
        homeworkId,
        studentId: req.studentRecord.id,
        ...(submissionText ? { text: submissionText } : {}),
        ...(req.file
          ? {
              fileName: safeFileName,
              contentType: type.mime,
              fileSize: req.file.size,
              fileData: req.file.buffer,
            }
          : {}),
        status: 'submitted',
        submittedAt: new Date(),
      };
      await db.collection('submissions').insertOne(submission);
      const { fileData, ...response } = submission;
      return res.status(201).json({ success: true, data: response });
    } catch (error) {
      return next(error);
    }
  },
);

router.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      success: false,
      error:
        status === 413
          ? 'Upload exceeds the 5 MB limit.'
          : 'Upload must include one file and no more than 10 fields.',
    });
  }
  return next(error);
});

module.exports = router;
