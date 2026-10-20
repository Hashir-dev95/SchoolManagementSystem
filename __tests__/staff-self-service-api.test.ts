import { NativeModules, Platform } from 'react-native';
import { apiClient } from '../src/services/api/apiClient';
import { staffSelfService } from '../src/services/teacher/staffSelfService';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const client = jest.mocked(apiClient);
beforeEach(() => {
  client.request.mockReset().mockResolvedValue({ success: true, data: {} });
});
test('summary passes token with no client-supplied staff identity', async () => {
  await staffSelfService.summary('token');
  expect(client.request).toHaveBeenCalledWith('/teacher/self-service/summary', {
    token: 'token',
  });
});
test('leave carries stable operation metadata and no generic staff endpoint', async () => {
  const body = {
    startDate: '2027-01-01',
    endDate: '2027-01-02',
    leaveType: 'sick',
    reason: 'Rest',
    clientOperationId: 'same_id',
  };
  await staffSelfService.leave('token', body);
  expect(client.request).toHaveBeenCalledWith('/teacher/self-service/leave', {
    token: 'token',
    method: 'POST',
    body,
  });
});
test('reschedule escapes ID and carries revision', async () => {
  await staffSelfService.change('token', 'a/b', 'reschedule', { revision: 1 });
  expect(client.request).toHaveBeenCalledWith(
    '/teacher/self-service/appointments/a%2Fb/reschedule',
    { token: 'token', method: 'POST', body: { revision: 1 } },
  );
});
test('file opening passes only authorized bytes and MIME to native viewer', async () => {
  const prior = NativeModules.StaffFileShare;
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  NativeModules.StaffFileShare = { open: jest.fn().mockResolvedValue(true) };
  client.request.mockResolvedValue({
    success: true,
    data: { base64: 'Ynl0ZXM=', mime: 'application/pdf' },
  });
  try {
    await staffSelfService.openFile('secret-token', 'payslips', 'own');
    expect(client.request).toHaveBeenCalledWith(
      '/teacher/self-service/payslips/own/file-content',
      { token: 'secret-token' },
    );
    expect(NativeModules.StaffFileShare.open).toHaveBeenCalledWith(
      'Ynl0ZXM=',
      'application/pdf',
    );
  } finally {
    NativeModules.StaffFileShare = prior;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }
});
test('unsupported file viewer fails before download and never opens public links', async () => {
  const prior = NativeModules.StaffFileShare;
  NativeModules.StaffFileShare = undefined;
  try {
    await expect(
      staffSelfService.openFile('token', 'documents', 'own'),
    ).rejects.toThrow('not available');
    expect(client.request).not.toHaveBeenCalled();
  } finally {
    NativeModules.StaffFileShare = prior;
  }
});

test('a stale file response cannot open after blur, logout or account switch', async () => {
  const prior = NativeModules.StaffFileShare,
    os = Platform.OS;
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  NativeModules.StaffFileShare = { open: jest.fn() };
  client.request.mockResolvedValue({
    success: true,
    data: { base64: 'Ynl0ZXM=', mime: 'application/pdf' },
  });
  try {
    await expect(
      staffSelfService.openFile('old-token', 'payslips', 'own', () => false),
    ).rejects.toThrow('no longer active');
    expect(NativeModules.StaffFileShare.open).not.toHaveBeenCalled();
  } finally {
    NativeModules.StaffFileShare = prior;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }
});
