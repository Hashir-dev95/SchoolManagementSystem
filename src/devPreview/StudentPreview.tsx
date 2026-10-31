// Read-only adaptation of StudentDashboard.jsx and HiraHome.jsx on faraz-audit.
import React, { useState } from 'react';
import { PreviewPage, PreviewCard, PreviewTabs } from './PreviewUI';
import { studentSample } from './previewData';

export default function StudentPreview() {
  const [page, setPage] = useState('Timetable');
  return (
    <PreviewPage role="Student" title="Big ideas start with curious minds.">
      <PreviewCard
        title={studentSample.name}
        lines={['Fictional learner · school placement is not connected']}
      />
      <PreviewTabs
        items={['Timetable', 'Homework', 'Results']}
        selected={page}
        onSelect={setPage}
      />
      <PreviewCard
        title={page}
        lines={
          page === 'Timetable'
            ? studentSample.timetable
            : page === 'Homework'
            ? studentSample.homework
            : studentSample.results
        }
      />
    </PreviewPage>
  );
}
