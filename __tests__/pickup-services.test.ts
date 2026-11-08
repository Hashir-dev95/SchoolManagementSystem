import { apiClient, ApiError } from '../src/services/api/apiClient';
import {
  pickupAuthorizationService as service,
  pickupFieldErrors,
  pickupOperationId,
  type PickupWrite,
  type PickupFields,
} from '../src/services/parent/pickupAuthorizationService';
import { pickupAuthorizationReviewService as review } from '../src/services/principal/pickupAuthorizationReviewService';
import {
  pickupFields as fields,
  pickupDetail,
  pickupReview,
  pickupResult,
} from './helpers/pickup-fixture';

afterEach(() => jest.restoreAllMocks());
test('bounded exact state filter uses the canonical authenticated Parent endpoint', async () => {
  const request = jest.spyOn(apiClient, 'request').mockResolvedValue({
    success: true,
    data: { items: [], nextOffset: null },
  });
  await service.list('real-token', 'child/encoded', 20, 'changes_requested');
  expect(request).toHaveBeenCalledWith(
    '/parent/me/children/child%2Fencoded/pickup-authorizations?offset=20&state=changes_requested',
    expect.objectContaining({ token: 'real-token' }),
  );
});
const versions = {
  applicationRevision: 2,
  personRevision: 1,
  approvalVersion: 3,
};
test.each<PickupWrite>([
  { kind: 'create', body: { ...fields, clientOperationId: 'nonce' } },
  {
    kind: 'edit',
    id: 'proposal-A',
    body: {
      ...fields,
      applicationRevision: 2,
      personRevision: 1,
      clientOperationId: 'nonce',
    },
  },
  {
    kind: 'submit',
    id: 'proposal-A',
    body: {
      applicationRevision: 2,
      personRevision: 1,
      clientOperationId: 'nonce',
    },
  },
  {
    kind: 'withdraw',
    id: 'proposal-A',
    body: { ...versions, clientOperationId: 'nonce' },
  },
  {
    kind: 'resubmit',
    id: 'proposal-A',
    body: { ...fields, ...versions, clientOperationId: 'nonce' },
  },
])(
  '$kind sends only its exact payload and expected revisions',
  async operation => {
    const request = jest
      .spyOn(apiClient, 'request')
      .mockResolvedValue({ data: pickupResult(pickupDetail()) });
    await service.write('token', 'A', operation);
    expect(request).toHaveBeenCalledWith(
      '/parent/me/children/A/pickup-authorizations' +
        (operation.kind === 'create'
          ? ''
          : '/proposal-A' +
            (operation.kind === 'edit' ? '' : '/' + operation.kind)),
      {
        token: 'token',
        method: operation.kind === 'edit' ? 'PATCH' : 'POST',
        body: operation.body,
      },
    );
  },
);
test('foreign-child detail is concealed, without trusting a mismatched DTO', async () => {
  jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: pickupDetail({ studentId: 'foreign' }) });
  await expect(
    service.detail('token', 'A', 'proposal-A'),
  ).rejects.toBeInstanceOf(ApiError);
});
test('Principal uses only typed queue, detail and decision URLs', async () => {
  const request = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValueOnce({ data: { items: [], nextOffset: null } })
    .mockResolvedValueOnce({ data: pickupReview() })
    .mockResolvedValueOnce({ data: pickupResult(pickupReview()) });
  await review.list('token', 20);
  await review.detail('token', 'approval-A');
  const body = {
    ...versions,
    action: 'reject' as const,
    decisionReason: 'Review explanation',
    clientOperationId: 'nonce',
  };
  await review.decide('token', 'approval-A', body);
  expect(request.mock.calls.map(call => call[0])).toEqual([
    '/principal/pickup-authorizations?offset=20',
    '/principal/pickup-authorizations/approval-A',
    '/principal/pickup-authorizations/approval-A/decisions',
  ]);
  expect(request.mock.calls[2][1]).toEqual({
    token: 'token',
    method: 'POST',
    body,
  });
});
test.each<[keyof PickupFields, string]>([
  ['validFromDate', '2026-02-30'],
  ['validUntilDate', '2026-11-01'],
  ['fullName', 'X'],
  ['relationship', 'X'],
  ['phone', 'letters'],
  ['notes', 'x'.repeat(501)] as const,
])('rejects invalid %s locally', (field, value) => {
  expect(pickupFieldErrors({ ...fields, [field]: value })[field]).toBeDefined();
});
test('valid fields pass without imposing a school duration rule', () =>
  expect(
    pickupFieldErrors({ ...fields, validUntilDate: '2027-11-13' }),
  ).toEqual({}));
test('secure UUID v4 operation IDs require native cryptographic randomness', () => {
  const runtime = globalThis as typeof globalThis & {
    RN$Bridgeless?: boolean;
    crypto?: { getRandomValues(bytes: Uint8Array): Uint8Array };
  };
  const old = Object.getOwnPropertyDescriptor(globalThis, 'crypto'),
    bridgeless = runtime.RN$Bridgeless;
  try {
    runtime.RN$Bridgeless = true;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(17) },
    });
    expect(pickupOperationId()).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });
    expect(pickupOperationId).toThrow('native runtime');
  } finally {
    if (old) Object.defineProperty(globalThis, 'crypto', old);
    else Reflect.deleteProperty(globalThis, 'crypto');
    runtime.RN$Bridgeless = bridgeless;
  }
});
