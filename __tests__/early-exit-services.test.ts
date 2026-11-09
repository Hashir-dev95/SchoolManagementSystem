import { apiClient, ApiError } from '../src/services/api/apiClient';
import {
  earlyExitService as service,
  earlyExitFieldErrors,
  type EarlyExitWrite,
  type EarlyExitFields,
} from '../src/services/parent/earlyExitService';
import {
  earlyExitReviewService as review,
  type EarlyExitDecision,
} from '../src/services/principal/earlyExitReviewService';
import {
  earlyExitFields as fields,
  earlyExitDetail,
  earlyExitReview,
  earlyExitResult,
} from './helpers/early-exit-fixture';

afterEach(() => jest.restoreAllMocks());
const respond = (data: unknown) =>
  jest.spyOn(apiClient, 'request').mockResolvedValue({ success: true, data });
test.each([
  'draft',
  'pending',
  'changes_requested',
  'rejected',
  'withdrawn',
] as const)(
  'authenticated bounded %s list uses only canonical child scope',
  async state => {
    const request = respond({ items: [], nextOffset: null });
    await service.list('real-token', 'child/encoded', 20, state);
    expect(request).toHaveBeenCalledWith(
      `/parent/me/children/child%2Fencoded/early-exit-requests?offset=20&state=${state}`,
      { token: 'real-token', method: undefined, body: undefined },
    );
  },
);
const versions = { applicationRevision: 2, approvalVersion: 3 };
test.each<EarlyExitWrite>([
  { kind: 'create', body: { ...fields, clientOperationId: 'nonce' } },
  {
    kind: 'edit',
    id: 'request-A',
    body: { ...fields, applicationRevision: 2, clientOperationId: 'nonce' },
  },
  {
    kind: 'submit',
    id: 'request-A',
    body: { applicationRevision: 2, clientOperationId: 'nonce' },
  },
  {
    kind: 'withdraw',
    id: 'request-A',
    body: { ...versions, clientOperationId: 'nonce' },
  },
  {
    kind: 'resubmit',
    id: 'request-A',
    body: { ...fields, ...versions, clientOperationId: 'nonce' },
  },
])(
  '$kind sends exact supported method, payload and canonical versions',
  async operation => {
    const request = respond(earlyExitResult(earlyExitDetail()));
    await service.write('token', 'A', operation);
    expect(request).toHaveBeenCalledWith(
      '/parent/me/children/A/early-exit-requests' +
        (operation.kind === 'create'
          ? ''
          : '/request-A' +
            (operation.kind === 'edit' ? '' : '/' + operation.kind)),
      {
        token: 'token',
        method: operation.kind === 'edit' ? 'PATCH' : 'POST',
        body: operation.body,
      },
    );
  },
);
test('NFC normalized and trimmed reason is sent without adding exit-hour policy', async () => {
  const request = respond(earlyExitResult(earlyExitDetail()));
  await service.write('token', 'A', {
    kind: 'create',
    body: { ...fields, reason: '  cafe\u0301  ', clientOperationId: 'nonce' },
  });
  expect(request.mock.calls[0][1]?.body).toEqual({
    exitDate: fields.exitDate,
    reason: 'café',
    clientOperationId: 'nonce',
  });
});
test.each<[keyof EarlyExitFields, string]>([
  ['exitDate', '2026-02-30'],
  ['exitDate', '2026-2-01'],
  ['exitDate', '0000-01-01'],
  ['reason', '  '],
  ['reason', 'x'.repeat(501)],
])('invalid %s is rejected before network write', async (key, value) => {
  const request = respond({});
  const invalid = { ...fields, [key]: value };
  expect(earlyExitFieldErrors(invalid)[key]).toBeDefined();
  await expect(
    service.write('token', 'A', {
      kind: 'create',
      body: { ...invalid, clientOperationId: 'nonce' },
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(request).not.toHaveBeenCalled();
});
test.each([-1, 1.5, 100001, NaN])(
  'invalid page %s never reaches the API',
  async offset => {
    const request = respond({});
    await expect(service.list('token', 'A', offset)).rejects.toMatchObject({
      status: 400,
    });
    expect(request).not.toHaveBeenCalled();
  },
);
test('unknown authority fields and unsupported states fail closed', async () => {
  const request = respond({});
  const forged = {
    kind: 'create' as const,
    body: {
      ...fields,
      clientOperationId: 'nonce',
      branchId: 'foreign',
      verified: true,
    },
  };
  await expect(service.write('token', 'A', forged)).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    service.list('token', 'A', 0, 'approved' as never),
  ).rejects.toMatchObject({ status: 400 });
  expect(request).not.toHaveBeenCalled();
});
test.each(['child', 'request'] as const)(
  'mismatched %s detail never reaches protected UI',
  async mismatch => {
    respond(
      earlyExitDetail(
        mismatch === 'child'
          ? { studentId: 'foreign' }
          : { requestId: 'foreign' },
      ),
    );
    await expect(
      service.detail('token', 'A', 'request-A'),
    ).rejects.toMatchObject({ status: 404 });
  },
);
test('mixed-child history response is rejected as a whole', async () => {
  respond({
    items: [earlyExitDetail(), earlyExitDetail({ studentId: 'foreign' })],
    nextOffset: null,
  });
  await expect(service.list('token', 'A')).rejects.toMatchObject({
    status: 404,
  });
});
test('Principal queue/detail/decision use canonical approval IDs and never transmit response-validation Branch as authority', async () => {
  const request = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValueOnce({
      success: true,
      data: { items: [earlyExitReview()], nextOffset: null },
    })
    .mockResolvedValueOnce({ success: true, data: earlyExitReview() })
    .mockResolvedValueOnce({
      success: true,
      data: earlyExitResult(earlyExitReview()),
    });
  await review.list('token', 'branch', 20);
  await review.detail('token', 'branch', 'approval-A');
  const body: EarlyExitDecision = {
    ...versions,
    action: 'reject',
    decisionReason: 'Valid reviewed reason',
    clientOperationId: 'nonce',
  };
  await review.decide('token', 'branch', 'approval-A', body);
  expect(request.mock.calls.map(call => call[0])).toEqual([
    '/principal/early-exit-requests?offset=20',
    '/principal/early-exit-requests/approval-A',
    '/principal/early-exit-requests/approval-A/decisions',
  ]);
  expect(request.mock.calls[2][1]).toEqual({
    token: 'token',
    method: 'POST',
    body,
  });
});
test.each(['branch', 'approval'] as const)(
  'Principal %s mismatch conceals the response',
  async mismatch => {
    respond(
      earlyExitReview(
        mismatch === 'branch'
          ? { student: { ...earlyExitReview().student, branchId: 'foreign' } }
          : { approvalId: 'foreign' },
      ),
    );
    await expect(
      review.detail('token', 'branch', 'approval-A'),
    ).rejects.toMatchObject({ status: 404 });
  },
);
test.each(['short', 'x'.repeat(501)])(
  'Principal decision requires a valid explanation',
  async reason => {
    const request = respond({});
    await expect(
      review.decide('token', 'branch', 'approval-A', {
        ...versions,
        action: 'reject',
        decisionReason: reason,
        clientOperationId: 'nonce',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  },
);
test('runtime forged approval cannot reach a decision endpoint', async () => {
  const request = respond({});
  await expect(
    review.decide('token', 'branch', 'approval-A', {
      ...versions,
      action: 'approve' as never,
      decisionReason: 'Forged operational approval',
      clientOperationId: 'nonce',
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(request).not.toHaveBeenCalled();
});
test.each([400, 401, 403, 404, 409, 503])(
  'current HTTP %s propagates without alternate endpoints or retry-created IDs',
  async status => {
    const request = jest
      .spyOn(apiClient, 'request')
      .mockRejectedValue(new ApiError(status, 'safe server failure'));
    await expect(
      service.detail('token', 'A', 'request-A'),
    ).rejects.toMatchObject({ status });
    expect(request).toHaveBeenCalledTimes(1);
  },
);
test('unconfirmed envelopes do not report success', async () => {
  jest.spyOn(apiClient, 'request').mockResolvedValue({ success: false });
  await expect(
    service.write('token', 'A', {
      kind: 'create',
      body: { ...fields, clientOperationId: 'nonce' },
    }),
  ).rejects.toThrow('unconfirmed');
});
