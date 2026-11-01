import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { SectionCard } from './SectionCard';
import { colors, typography } from '../../theme/hiraDashboard';
import type { FeeList } from '../../services/finance/financeService';
/** Server-formatted money/status only. Rendering a receipt never creates payment. */
export function FeeCards({ data }: { data: FeeList }) {
  return (
    <>
      {data.legacyUnmigratedCount ? (
        <Text style={styles.note}>
          {data.legacyUnmigratedCount} legacy fee records require reconciliation
          and are excluded from these balances.
        </Text>
      ) : null}
      {data.onlinePayments ? (
        <Text style={styles.note}>{data.onlinePayments.message}</Text>
      ) : null}
      {!data.items.length ? (
        <Text style={styles.text}>No assigned fee obligations.</Text>
      ) : (
        data.items.map(fee => (
          <SectionCard key={fee.id} title={fee.title}>
            <Text style={styles.text}>
              {fee.challanReference} · {fee.academicPeriod}
            </Text>
            <Text style={styles.text}>
              Due {fee.dueDate} · {fee.status}
            </Text>
            <Text style={styles.text}>Amount: {fee.amountLabel}</Text>
            <Text style={styles.text}>Paid: {fee.paidLabel}</Text>
            <Text style={styles.text}>Reserved: {fee.reservedLabel}</Text>
            <Text style={styles.text}>Balance: {fee.balanceLabel}</Text>
            {fee.receipts.map(receipt => (
              <Text key={receipt.id} style={styles.text}>
                Receipt {receipt.reference} · {receipt.amountLabel} ·{' '}
                {receipt.method} · {receipt.paidAt} · settled
              </Text>
            ))}
          </SectionCard>
        ))
      )}
    </>
  );
}
const styles = StyleSheet.create({
  text: { ...typography.body, color: colors.ink },
  note: { ...typography.small, color: colors.muted, marginBottom: 12 },
});
