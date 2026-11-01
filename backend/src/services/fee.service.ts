// Legacy Fee records are retained for reconciliation/approval references only.
// Every live summary now derives from canonical obligations + settled transactions.
import { branchFinanceSummary } from './finance-authority.service';
export interface FeeSummary {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  pendingInvoices: number;
  partialInvoices: number;
  paidInvoices: number;
  overdueInvoices: number;
  legacyUnmigratedCount: number;
}
export const getBranchFeeSummary = async (
  branchId: string,
  academicYear?: string,
): Promise<FeeSummary> => {
  const row = await branchFinanceSummary(branchId, academicYear);
  return {
    totalInvoices: row.totalInvoices,
    totalAmount: row.amountMinor / 100,
    paidAmount: row.paidMinor / 100,
    outstandingAmount: row.balanceMinor / 100,
    pendingInvoices: row.totalInvoices - row.paidInvoices - row.partialInvoices,
    partialInvoices: row.partialInvoices,
    paidInvoices: row.paidInvoices,
    overdueInvoices: row.overdueInvoices,
    legacyUnmigratedCount: row.legacyUnmigratedCount,
  };
};
