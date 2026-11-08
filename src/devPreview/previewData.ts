// Small fictional subset adapted from faraz-audit:src/mobileApp/shared/data/previewData.js.
// Display strings only: never domain authority, API payloads or a service response.
export const studentSample = {
  name: 'Amina Khan',
  timetable: [
    'Monday · 08:00–08:45 · Mathematics · Room 08',
    'Monday · 09:00–09:45 · Science · Lab 02',
  ],
  homework: ['Fractions practice', 'Complete practice questions 1–5.'],
  results: [
    'Term assessment · Mathematics · 88/100',
    'Fictional sample feedback.',
  ],
};
export const childSamples = ['Ahmed Khan', 'Sara Khan'] as const;
export const pickupPreviewSamples = [
  {
    name: 'Sample Guardian One',
    relationship: 'Fictional aunt',
    state: 'Pending',
    detail: 'Sample proposal awaiting configured school review.',
  },
  {
    name: 'Sample Guardian Two',
    relationship: 'Fictional uncle',
    state: 'Changes Requested',
    detail: 'Sample explanation: revise the proposed contact details.',
  },
  {
    name: 'Sample Guardian Three',
    relationship: 'Fictional family friend',
    state: 'Rejected',
    detail: 'Sample explanation: the school cannot accept these proposed details.',
  },
] as const;
export const financeSample = {
  invoice: ['DEMO-2026-01 · October tuition', 'PKR 12,000 · Partially paid'],
  summary: [
    'Sample invoice amount · PKR 12,000',
    'Confirmed sample payments · PKR 4,000',
    'Sample balance · PKR 8,000',
  ],
};
