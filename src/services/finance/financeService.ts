import { apiClient } from '../api/apiClient';
export interface FeeView {
  id: string;
  studentId: string;
  title: string;
  academicPeriod: string;
  challanReference: string;
  currency: string;
  dueDate: string;
  amountLabel: string;
  paidLabel: string;
  reservedLabel: string;
  balanceLabel: string;
  status: string;
  receipts: {
    id: string;
    reference: string;
    paymentReference: string;
    amountLabel: string;
    method: string;
    paidAt: string;
    status: 'settled';
  }[];
}
export interface FeeList {
  items: FeeView[];
  legacyUnmigratedCount?: number;
  onlinePayments?: { enabled: boolean; message: string };
}
export interface PaymentView {
  id: string;
  feeId: string;
  amountLabel: string;
  reference: string;
  status: string;
  method: string;
  revision: number;
  canVerify: boolean;
  expired: boolean;
}
export interface StructureView {
  _id: string;
  title: string;
  amountMinor: number;
  currency: string;
}
export interface FinanceSummary {
  totalInvoices: number;
  amountLabel: string;
  paidLabel: string;
  balanceLabel: string;
  legacyUnmigratedCount: number;
}
export interface ReconciliationView {
  items: { id: string; reference: string; status: string; reason: string }[];
  observations: { eventId: string; orderRef: string; outcome: string }[];
}
const read = async <T>(token: string, path: string) =>
  (await apiClient.request<{ data: T }>(`/finance/me${path}`, { token })).data;
const write = async <T>(token: string, path: string, body: unknown) =>
  (
    await apiClient.request<{ data: T }>(`/finance/me${path}`, {
      token,
      method: 'POST',
      body,
    })
  ).data;
export const financeService = {
  summary: (token: string) => read<FinanceSummary>(token, '/summary'),
  fees: (token: string) => read<FeeList>(token, '/fees'),
  payments: (token: string) =>
    read<{ items: PaymentView[] }>(token, '/payments'),
  reconciliation: (token: string) =>
    read<ReconciliationView>(token, '/reconciliation'),
  structures: (token: string) =>
    read<{ items: StructureView[] }>(token, '/structures'),
  students: (token: string) =>
    read<{
      items: { id: string; fullName: string; admissionNumber: string }[];
    }>(token, '/students'),
  createStructure: (
    token: string,
    body: { title: string; amountMinor: number; operationId: string },
  ) => write<StructureView>(token, '/structures', body),
  assign: (
    token: string,
    body: {
      studentId: string;
      structureId: string;
      dueDate: string;
      operationId: string;
    },
  ) => write<FeeView>(token, '/fees', body),
  record: (
    token: string,
    feeId: string,
    body: {
      method: 'bank_transfer' | 'cash';
      reference: string;
      operationId: string;
    },
  ) =>
    write<PaymentView>(
      token,
      `/fees/${encodeURIComponent(feeId)}/manual-payments`,
      body,
    ),
  verify: (
    token: string,
    paymentId: string,
    body: { revision: number; reviewNote: string; operationId: string },
    reject = false,
  ) =>
    write<unknown>(
      token,
      `/payments/${encodeURIComponent(paymentId)}/${
        reject ? 'reject' : 'verify'
      }`,
      body,
    ),
};
