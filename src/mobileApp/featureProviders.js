import { parentApi } from './parentService';
import { studentApi } from './studentService';
import { financeApi } from './financeService';
const rows = (data) => (Array.isArray(data) ? data : []);
function record(item, index) {
  return {
    ...item,
    id: item.id || item._id || `record-${index}`,
    title:
      item.title ||
      item.examName ||
      item.subject ||
      item.student ||
      item.description ||
      item.name ||
      'Record',
    subtitle: [item.grade, item.date, item.dueDate, item.status]
      .filter(Boolean)
      .join(' · '),
    body:
      item.teacherFeedback || item.feedback || item.body || item.message || '',
    value: typeof item.progress === 'number' ? item.progress : undefined,
  };
}
async function childId(preferred) {
  const children = await parentApi.getChildren();
  const verified =
    rows(children).find((child) => child.id === preferred) || rows(children)[0];
  return verified?.id;
}
export function getFeatureProvider(role, page, preferredChild) {
  const academic = [
    'Academic Report',
    'Student Progress Tracking',
    'Monthly Feedback',
  ];
  if (role === 'Student' && academic.includes(page))
    return {
      load: async () => {
        const data =
          page === 'Academic Report'
            ? await studentApi.getResults()
            : await studentApi.getProgress();
        return { records: rows(data).map(record) };
      },
    };
  if (
    role === 'Parent' &&
    [
      'Academic Report',
      'Monthly Feedback',
      'Student Progress Tracking',
    ].includes(page)
  )
    return {
      load: async () => {
        const id = await childId(preferredChild);
        if (!id) return { records: [] };
        if (page === 'Academic Report')
          return { records: rows(await parentApi.getResults(id)).map(record) };
        const feedback = await parentApi.getFeedback(id);
        return {
          records: [
            ...rows(feedback?.progress),
            ...rows(feedback?.results),
            ...rows(feedback?.homework),
          ].map(record),
        };
      },
    };
  if (role === 'Finance' && page === 'Student Ledger')
    return {
      load: async (filters) => {
        const response = await financeApi.getDues({
          studentId: filters['Student ID'],
          from: filters['From date'],
          to: filters['To date'],
        });
        return {
          records: rows(response.data).map((item, i) => ({
            ...record(item, i),
            body: `Confirmed paid: ${item.paidAmount ?? '—'} · Pending: ${
              item.pendingAmount ?? '—'
            } · Due: ${item.balanceDue ?? '—'}`,
          })),
        };
      },
    };
  if (role === 'Finance' && page === 'Voucher Scan')
    return {
      submit: async (form) => {
        const response = await financeApi.verifyVoucher(form['Voucher code']);
        return {
          records: [
            {
              ...response.data,
              title: response.data?.student || 'Voucher',
              subtitle: response.data?.voucherCode,
              body: `Paid: ${response.data?.paidAmount ?? '—'} · Pending: ${
                response.data?.pendingAmount ?? '—'
              } · Due: ${response.data?.balanceDue ?? '—'}`,
            },
          ],
        };
      },
    };
  if (role === 'Finance' && page === 'Receipt Details')
    return {
      submit: async (form) => {
        const response = await financeApi.getReceipt(form['Payment ID']);
        const receipt = response.data;
        return {
          records: [
            {
              ...receipt,
              title: receipt?.receiptNumber || 'Receipt',
              subtitle: receipt?.invoiceId,
              body: `Amount: ${receipt?.currency || ''} ${
                receipt?.amount ?? '—'
              } · Payment: ${receipt?.paymentId || form['Payment ID']}`,
            },
          ],
        };
      },
    };
  if (page === 'Attendance Calendar' && ['Student', 'Parent'].includes(role))
    return {
      load: async () => {
        const id = role === 'Parent' ? await childId(preferredChild) : null;
        if (role === 'Parent' && !id) return { records: [] };
        const data =
          role === 'Parent'
            ? await parentApi.getAttendance(id)
            : await studentApi.getAttendance();
        return {
          records: rows(data).map((item, index) => ({
            ...record(item, index),
            title: item.status || 'Attendance',
            date: item.date,
          })),
        };
      },
    };
  if (page === 'Leave Request' && ['Student', 'Parent'].includes(role))
    return {
      submit: async (form) => {
        const dates = [form['From date'], form['To date']];
        if (
          dates.some(
            (date) =>
              !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
              !Number.isFinite(Date.parse(date)),
          ) ||
          dates[1] < dates[0]
        )
          throw new Error(
            'Enter valid YYYY-MM-DD dates, with the end date after the start date.',
          );
        const application = {
          title: 'Leave request',
          message: `From ${dates[0]} to ${dates[1]}: ${form.Reason}`,
        };
        if (role === 'Student') await studentApi.submitApplication(application);
        else {
          const id = await childId(preferredChild);
          if (!id) throw new Error('No verified child is linked.');
          await parentApi.submitApplication(id, application);
        }
        return { records: [] };
      },
    };
  if (role === 'Finance' && page === 'Finance Reports')
    return {
      load: async (filters) => {
        const response = await financeApi.getCollectionReport({
          from: filters['From date'],
          to: filters['To date'],
        });
        return {
          records: rows(response.data?.byMethod).map((item, index) => ({
            id: item._id || index,
            title: String(item._id || 'Payment method'),
            body: `Confirmed amount: ${item.total} · Transactions: ${item.count}`,
            status: 'Confirmed',
          })),
        };
      },
    };
  return undefined;
}
