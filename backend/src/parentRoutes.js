const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');
const { createClassTeacherApplication } = require('./applicationService');

const router = express.Router();

function requireParentContext(req, res, next) {
  const userId = typeof req.user?.id === 'string' ? req.user.id.trim() : '';
  if (!userId) {
    return res
      .status(401)
      .json({ success: false, error: 'Trusted user context is required.' });
  }
  if (req.user.role !== 'parent') {
    return res
      .status(403)
      .json({ success: false, error: 'Parent access is required.' });
  }
  req.parentUserId = userId;
  return next();
}

function verifiedLinkFilter(parentUserId, studentId) {
  const filter = {
    parentUserId,
    revokedAt: null,
    $or: [{ status: 'verified' }, { verified: true }],
  };
  if (studentId) filter.studentId = studentId;
  return filter;
}

async function getVerifiedChild(parentUserId, studentId) {
  const db = getDatabase();
  const link = await db
    .collection('parentChildLinks')
    .findOne(verifiedLinkFilter(parentUserId, studentId));
  if (!link) return null;
  return db.collection('students').findOne(
    { id: link.studentId },
    {
      projection: {
        _id: 0,
        id: 1,
        name: 1,
        fullName: 1,
        grade: 1,
        section: 1,
        classId: 1,
        status: 1,
      },
    },
  );
}

function dateRange(query, field) {
  const from = typeof query.from === 'string' ? query.from : '';
  const to = typeof query.to === 'string' ? query.to : '';
  const isDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  };
  if ((from && !isDate(from)) || (to && !isDate(to))) {
    return { error: 'from and to must be valid YYYY-MM-DD dates.' };
  }
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

function childScheduleFilter(child) {
  const scope = [{ studentId: child.id }, { studentIds: child.id }];
  if (child.classId) scope.push({ classId: child.classId });
  return { $or: scope };
}

function publishedFilter() {
  return { $or: [{ published: true }, { status: 'published' }] };
}

router.use(requireParentContext);

router.get('/notifications', async (req, res, next) => {
  try {
    const links = await getDatabase()
      .collection('parentChildLinks')
      .find(verifiedLinkFilter(req.parentUserId))
      .toArray();
    const studentIds = [
      ...new Set(links.map(link => link.studentId).filter(Boolean)),
    ];
    const children = studentIds.length
      ? await getDatabase()
          .collection('students')
          .find(
            { id: { $in: studentIds } },
            { projection: { id: 1, classId: 1 } },
          )
          .toArray()
      : [];
    const classIds = [
      ...new Set(children.map(child => child.classId).filter(Boolean)),
    ];
    const notifications = classIds.length
      ? await getDatabase()
          .collection('parentNotifications')
          .find(
            {
              parentUserId: req.parentUserId,
              type: 'parent_dlp_shared',
              classId: { $in: classIds },
            },
            { projection: { parentUserId: 0 } },
          )
          .sort({ createdAt: -1 })
          .toArray()
      : [];
    const unreadCount = notifications.reduce(
      (count, notification) => count + (notification.readAt ? 0 : 1),
      0,
    );
    return res.json({
      success: true,
      data: { notifications, unreadCount },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/notifications/:notificationId/read', async (req, res, next) => {
  try {
    const id = req.params.notificationId;
    const identity = [{ id }];
    if (ObjectId.isValid(id)) identity.push({ _id: new ObjectId(id) });
    const collection = getDatabase().collection('parentNotifications');
    const notification = await collection.findOne({
      parentUserId: req.parentUserId,
      type: 'parent_dlp_shared',
      $or: identity,
    });
    if (!notification) {
      return res
        .status(404)
        .json({ success: false, error: 'Parent notification was not found.' });
    }

    const links = await getDatabase()
      .collection('parentChildLinks')
      .find(verifiedLinkFilter(req.parentUserId))
      .toArray();
    const studentIds = [
      ...new Set(links.map(link => link.studentId).filter(Boolean)),
    ];
    const hasClassAccess = studentIds.length
      ? await getDatabase()
          .collection('students')
          .findOne({
            id: { $in: studentIds },
            classId: notification.classId,
          })
      : null;
    if (!hasClassAccess) {
      return res.status(404).json({
        success: false,
        error: 'No verified linked child belongs to this notification class.',
      });
    }

    await collection.updateOne(
      { _id: notification._id, parentUserId: req.parentUserId },
      { $set: { readAt: new Date() } },
    );
    return res.json({ success: true, data: { read: true } });
  } catch (error) {
    return next(error);
  }
});

router.get('/notifications/:notificationId', async (req, res, next) => {
  try {
    const id = req.params.notificationId;
    const notificationMatch = [{ id }];
    if (ObjectId.isValid(id)) notificationMatch.push({ _id: new ObjectId(id) });
    const notification = await getDatabase()
      .collection('parentNotifications')
      .findOne({
        parentUserId: req.parentUserId,
        type: 'parent_dlp_shared',
        $or: notificationMatch,
      });
    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Parent DLP notification was not found.',
      });
    }

    const links = await getDatabase()
      .collection('parentChildLinks')
      .find(verifiedLinkFilter(req.parentUserId))
      .toArray();
    const studentIds = [
      ...new Set(links.map(link => link.studentId).filter(Boolean)),
    ];
    const hasClassAccess = studentIds.length
      ? await getDatabase()
          .collection('students')
          .findOne({
            id: { $in: studentIds },
            classId: notification.classId,
          })
      : null;
    if (!hasClassAccess) {
      return res.status(404).json({
        success: false,
        error: 'No verified linked child belongs to this DLP class.',
      });
    }

    const versionId = String(notification.dlpVersionId || '');
    const versionMatch = [{ id: versionId }];
    if (ObjectId.isValid(versionId))
      versionMatch.push({ _id: new ObjectId(versionId) });
    const dlpVersion = await getDatabase().collection('dlpVersions').findOne({
      $or: versionMatch,
      classId: notification.classId,
      audience: 'parent',
      status: 'published',
    });
    if (!dlpVersion) {
      return res.status(404).json({
        success: false,
        error: 'The exact shared Parent DLP version is no longer available.',
      });
    }
    return res.json({ success: true, data: { notification, dlpVersion } });
  } catch (error) {
    return next(error);
  }
});

router.get('/children', async (req, res, next) => {
  try {
    const links = await getDatabase()
      .collection('parentChildLinks')
      .find(verifiedLinkFilter(req.parentUserId))
      .toArray();
    const studentIds = [
      ...new Set(links.map(link => link.studentId).filter(Boolean)),
    ];
    const data = studentIds.length
      ? await getDatabase()
          .collection('students')
          .find(
            { id: { $in: studentIds } },
            {
              projection: {
                _id: 0,
                id: 1,
                name: 1,
                fullName: 1,
                grade: 1,
                section: 1,
                classId: 1,
                status: 1,
              },
            },
          )
          .toArray()
      : [];
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.use('/children/:studentId', async (req, res, next) => {
  try {
    const child = await getVerifiedChild(
      req.parentUserId,
      req.params.studentId,
    );
    if (!child) {
      return res
        .status(404)
        .json({ success: false, error: 'No verified linked child was found.' });
    }
    req.parentChild = child;
    return next();
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/applications', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('classTeacherApplications')
      .find(
        {
          applicantUserId: req.parentUserId,
          applicantRole: 'parent',
          studentId: req.parentChild.id,
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

router.post('/children/:studentId/applications', async (req, res, next) => {
  try {
    const result = await createClassTeacherApplication({
      input: req.body,
      applicant: { id: req.parentUserId },
      student: req.parentChild,
      applicantRole: 'parent',
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

router.get('/children/:studentId', (req, res) =>
  res.json({ success: true, data: req.parentChild }),
);

router.get('/children/:studentId/attendance', async (req, res, next) => {
  try {
    const range = dateRange(req.query, 'date');
    if (range.error)
      return res.status(400).json({ success: false, error: range.error });
    const data = await getDatabase()
      .collection('attendance')
      .find({ studentId: req.parentChild.id, ...range.filter })
      .sort({ date: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/timetable', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('timetable')
      .find(childScheduleFilter(req.parentChild))
      .sort({ dayOfWeek: 1, startTime: 1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/homework', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('homework')
      .find({ $and: [publishedFilter(), childScheduleFilter(req.parentChild)] })
      .sort({ dueDate: 1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/results', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('results')
      .find({ studentId: req.parentChild.id, ...publishedFilter() })
      .sort({ publishedAt: -1 })
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/fees', async (req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('invoices')
      .aggregate([
        { $match: { studentId: req.parentChild.id } },
        {
          $lookup: {
            from: 'payments',
            let: { invoiceId: '$id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$invoiceId', '$$invoiceId'] },
                      { $eq: ['$studentId', req.parentChild.id] },
                      { $eq: ['$status', 'confirmed'] },
                    ],
                  },
                },
              },
              { $group: { _id: null, paidAmount: { $sum: '$amount' } } },
            ],
            as: 'confirmedPayments',
          },
        },
        {
          $addFields: {
            confirmedPaidAmount: {
              $ifNull: [
                { $arrayElemAt: ['$confirmedPayments.paidAmount', 0] },
                0,
              ],
            },
          },
        },
        { $project: { confirmedPayments: 0, voucherCode: 0 } },
        { $sort: { dueDate: -1 } },
      ])
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/children/:studentId/feedback', async (req, res, next) => {
  try {
    const studentId = req.parentChild.id;
    const [homework, results, progress] = await Promise.all([
      getDatabase()
        .collection('submissions')
        .aggregate([
          {
            $match: {
              studentId,
              $or: [
                { teacherFeedback: { $type: 'string', $ne: '' } },
                { feedback: { $type: 'string', $ne: '' } },
              ],
            },
          },
            {
              $lookup: {
                from: 'homework',
                let: { submissionHomeworkId: '$homeworkId' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $or: [
                          { $eq: ['$id', '$$submissionHomeworkId'] },
                          {
                            $eq: [
                              { $toString: '$_id' },
                              '$$submissionHomeworkId',
                            ],
                          },
                        ],
                      },
                    },
                  },
                ],
                as: 'homework',
              },
            },
          { $unwind: { path: '$homework', preserveNullAndEmptyArrays: true } },
          { $project: { fileData: 0 } },
          { $sort: { submittedAt: -1 } },
        ])
        .toArray(),
      getDatabase()
        .collection('results')
        .find({
          $and: [
            { studentId },
            publishedFilter(),
            {
              $or: [
                { teacherFeedback: { $type: 'string', $ne: '' } },
                { feedback: { $type: 'string', $ne: '' } },
              ],
            },
          ],
        })
        .sort({ publishedAt: -1 })
        .toArray(),
      getDatabase()
        .collection('progress')
        .find({
          studentId,
          $or: [
            { teacherFeedback: { $type: 'string', $ne: '' } },
            { feedback: { $type: 'string', $ne: '' } },
          ],
        })
        .sort({ updatedAt: -1 })
        .toArray(),
    ]);
    return res.json({ success: true, data: { homework, results, progress } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
