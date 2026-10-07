import { rolePages, previewRolePages } from '../hiraTheme';
import { features } from '../featureScreens';
import { getFeatureProvider } from '../featureProviders';

const directPages = {
  Student: new Set([
    'Home', 'Profile', 'Timetable', 'Attendance', 'Results', 'Progress',
    'Homework', 'Applications', 'Inbox',
  ]),
  Parent: new Set([
    'Home', 'My children', 'Attendance', 'Timetable', 'Homework', 'Results',
    'Progress', 'Fees', 'Applications', 'Inbox',
  ]),
  Finance: new Set([
    'Home', 'Student search', 'Outstanding dues', 'Invoices',
    'Voucher verification', 'Payment entry', 'Pending verification',
    'Payment history', 'Receipts', 'Collection report', 'Inbox',
  ]),
};

test.each(['Student', 'Parent', 'Finance'])(
  '%s production menu contains only implemented pages',
  role => {
    for (const page of rolePages[role]) {
      if (directPages[role].has(page)) continue;
      expect(features[page]).toBeDefined();
      const provider = getFeatureProvider(role, page, '002');
      expect(provider).toBeDefined();
      expect(typeof provider.load === 'function' || typeof provider.submit === 'function').toBe(true);
    }
  },
);

test('external-service concepts stay in explicit developer preview only', () => {
  const unavailable = {
    Student: ['AI Tutor', 'Live Classroom', 'Messages', 'Helpdesk'],
    Parent: ['Track My Child', 'Online Payment', 'Messages', 'Helpdesk'],
    Finance: ['Advance Balances', 'Finance Requests', 'Exceptions & Closing', 'Messages'],
  };
  for (const [role, pages] of Object.entries(unavailable)) {
    for (const page of pages) {
      expect(rolePages[role]).not.toContain(page);
      expect(previewRolePages[role]).toContain(page);
    }
  }
});
