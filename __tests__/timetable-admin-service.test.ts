import { apiClient } from '../src/services/api/apiClient';
import { timetableAdminService as service } from '../src/services/admin/timetableAdminService';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const request = jest.mocked(apiClient.request);
beforeEach(() =>
  request
    .mockReset()
    .mockResolvedValue({ data: { versionId: 'v', status: 'draft' } })
);
test('create sends only existing backend contract, retaining numeric weekday and exact 24-hour clocks', async () => {
  const slot = {
    teacherId: 't',
    classId: 'c',
    sectionId: 's',
    subjectId: 'm',
    dayOfWeek: 0,
    startTime: '13:05',
    endTime: '14:00',
    roomId: 'r',
    room: 'R',
  };
  await service.create('token', {
    branchId: 'b',
    versionNumber: 3,
    effectiveFrom: '2026-10-01',
    effectiveUntil: '2026-11-01',
    periods: [{ ...slot, ...{ teacherName: 'label', periodId: 'old' } }],
  });
  expect(request).toHaveBeenCalledWith('/timetables/versions', {
    token: 'token',
    method: 'POST',
    body: {
      branchId: 'b',
      versionNumber: 3,
      effectiveFrom: '2026-10-01',
      effectiveUntil: '2026-11-01',
      periods: [
        {
          teacherId: slot.teacherId,
          classId: slot.classId,
          sectionId: slot.sectionId,
          subjectId: slot.subjectId,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          roomId: 'r',
        },
      ],
    },
  });
});
test('read/approval encode references and carry authenticated token with no role claims', async () => {
  await service.options('token', {
    branchId: 'b/x',
    teacherId: 't',
    offset: 50,
  });
  expect(request).toHaveBeenLastCalledWith(
    '/timetables/options?branchId=b%2Fx&teacherId=t&offset=50',
    { token: 'token' }
  );
  await service.list('token', 'b', 10);
  expect(request).toHaveBeenLastCalledWith(
    '/timetables/versions?branchId=b&offset=10',
    { token: 'token' }
  );
  await service.approve('token', 'v/x');
  expect(request).toHaveBeenLastCalledWith(
    '/timetables/versions/v%2Fx/approve',
    { token: 'token', method: 'POST', body: {} }
  );
});

test('Class loader reuses Academic Setup DTO and loads every page for the selected branch', async () => {
  const a = {
    id: 'c1',
    name: 'Grade 8',
    code: 'G8',
    isActive: true,
    revision: 1,
    periodStatus: 'active',
    legacy: false,
  };
  const b = { ...a, id: 'c2', code: 'G9', name: 'Grade 9' };
  request
    .mockResolvedValueOnce({
      success: true,
      data: { items: [a], nextOffset: 50 },
    })
    .mockResolvedValueOnce({
      success: true,
      data: { items: [b], nextOffset: null },
    });
  expect(await service.classes('token', 'branch/x')).toEqual([a, b]);
  expect(request).toHaveBeenNthCalledWith(
    1,
    '/academic-setup/classes?branchId=branch%2Fx&offset=0',
    { token: 'token', method: 'GET' }
  );
  expect(request).toHaveBeenNthCalledWith(
    2,
    '/academic-setup/classes?branchId=branch%2Fx&offset=50',
    { token: 'token', method: 'GET' }
  );
});

test('Class loader preserves catalog failures and refuses non-progressing pagination', async () => {
  request.mockRejectedValueOnce(new Error('forbidden'));
  await expect(service.classes('token', 'branch')).rejects.toThrow('forbidden');
  request.mockResolvedValueOnce({
    success: true,
    data: { items: [], nextOffset: 0 },
  });
  await expect(service.classes('token', 'branch')).rejects.toThrow(
    'Class list could not be loaded'
  );
});

test('Section catalog uses canonical Class/Branch IDs and all-page DTO rather than assignment tuples', async () => {
  request.mockResolvedValueOnce({
    success: true,
    data: {
      items: [{ id: 's', classId: 'c', name: 'A', code: 'A', isActive: true }],
      nextOffset: null,
    },
  });
  expect((await service.sections('token', 'b', 'c'))[0].id).toBe('s');
  expect(request).toHaveBeenLastCalledWith(
    '/academic-setup/sections?branchId=b&classId=c&offset=0',
    { token: 'token', method: 'GET' }
  );
});

test('Subjects reuse mapped curriculum contract; eligible Teachers use exact combination and paginate', async () => {
  const mapping = {
    id: 'map',
    subject: { id: 'subject', name: 'Math', isActive: true },
    isActive: true,
  };
  request.mockResolvedValueOnce({
    success: true,
    data: { writable: true, items: [mapping], nextOffset: null },
  });
  expect(await service.subjects('token', 'b', 'c')).toEqual([mapping]);
  expect(request).toHaveBeenLastCalledWith(
    '/academic-setup/classes/c/subjects?branchId=b&offset=0',
    { token: 'token', method: 'GET' }
  );
  request
    .mockResolvedValueOnce({
      data: { teachers: [{ id: 't', name: 'A' }], nextTeacherOffset: 50 },
    })
    .mockResolvedValueOnce({
      data: { teachers: [{ id: 't2', name: 'B' }], nextTeacherOffset: null },
    });
  expect(
    (await service.eligibleTeachers('token', 'b', 'c', 's', 'subject')).items
  ).toHaveLength(2);
  expect(request).toHaveBeenLastCalledWith(
    '/timetables/options?branchId=b&classId=c&sectionId=s&subjectId=subject&offset=50',
    { token: 'token' }
  );
});

test('eligible Teacher adapter preserves server diagnosis and never guesses why an empty response occurred', async () => {
  const eligibility = {
    asOf: '2026-10-13T06:00:00.000Z',
    reasons: ['future_assignment'],
  };
  request.mockResolvedValueOnce({
    data: {
      teachers: [],
      nextTeacherOffset: null,
      teacherEligibility: eligibility,
    },
  });
  expect(
    await service.eligibleTeachers('token', 'b', 'c', 's', 'subject')
  ).toEqual({ items: [], eligibility });
  request.mockResolvedValueOnce({
    data: { teachers: [], nextTeacherOffset: null },
  });
  expect(
    await service.eligibleTeachers('token', 'b', 'c', 's', 'subject')
  ).toEqual({ items: [], eligibility: undefined });
  request.mockRejectedValueOnce(new Error('network'));
  await expect(
    service.eligibleTeachers('token', 'b', 'c', 's', 'subject')
  ).rejects.toThrow('network');
});

test('Room catalog reuses Academic Setup, collects all pages and preserves canonical IDs', async () => {
  request
    .mockResolvedValueOnce({
      success: true,
      data: {
        items: [
          {
            id: 'r',
            name: 'Science Lab',
            code: 'LAB1',
            category: 'science_lab',
            isActive: true,
          },
        ],
        nextOffset: 50,
      },
    })
    .mockResolvedValueOnce({
      success: true,
      data: {
        items: [
          {
            id: 'r2',
            name: 'Hall',
            code: 'H1',
            category: 'hall',
            isActive: false,
          },
        ],
        nextOffset: null,
      },
    });
  expect((await service.rooms('token', 'b')).map((r) => r.id)).toEqual([
    'r',
    'r2',
  ]);
  expect(request).toHaveBeenNthCalledWith(
    1,
    '/academic-setup/rooms?branchId=b&offset=0',
    { token: 'token', method: 'GET' }
  );
  expect(request).toHaveBeenLastCalledWith(
    '/academic-setup/rooms?branchId=b&offset=50',
    { token: 'token', method: 'GET' }
  );
});
