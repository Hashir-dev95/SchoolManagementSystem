import type { FeeList } from '../../src/services/finance/financeService';
export const fees: FeeList = {
  items: [
    {
      id: 'fee-1',
      studentId: 'student-1',
      title: 'Canonical tuition',
      academicPeriod: 'Current term',
      challanReference: 'CH-001',
      currency: 'PKR',
      dueDate: '2026-11-15',
      amountLabel: 'PKR 300.00',
      paidLabel: 'PKR 0.00',
      reservedLabel: 'PKR 0.00',
      balanceLabel: 'PKR 300.00',
      status: 'due',
      receipts: [],
    },
  ],
  onlinePayments: {
    enabled: false,
    message: 'Online payments unavailable — provider validation pending',
  },
};
