import React from 'react';
import FinanceDashboard from './FinanceDashboard';
import StudentDashboard from './StudentDashboard';
import ParentDashboard from './ParentDashboard';
import TeachersDlpPage from './TeachersDlpPage';
export default function RoleDashboard({
  role,
  previewOnly = false,
  searchQuery = '',
  initialChildId,
  page,
}) {
  const Component = page === 'Teachers DLP' && ['Teacher', 'Principal', 'Super Admin'].includes(role) ? TeachersDlpPage : {
    Finance: FinanceDashboard,
    Student: StudentDashboard,
    Parent: ParentDashboard,
  }[role];
  return Component ? (
    <Component
      previewOnly={previewOnly}
      searchQuery={searchQuery}
      page={page}
      initialChildId={initialChildId}
    />
  ) : null;
}
