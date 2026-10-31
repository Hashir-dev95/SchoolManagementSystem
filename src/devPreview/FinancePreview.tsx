// Overview/invoice card adaptation of faraz-audit FinanceDashboard.jsx and HiraHome.jsx.
import React, { useState } from 'react';
import { PreviewPage, PreviewCard, PreviewTabs } from './PreviewUI';
import { financeSample } from './previewData';

export default function FinancePreview() {
  const [page, setPage] = useState('Overview');
  return (
    <PreviewPage role="Finance" title="Less paperwork. More peace of mind.">
      <PreviewTabs
        items={['Overview', 'Fees & challans']}
        selected={page}
        onSelect={setPage}
      />
      <PreviewCard
        title={page}
        lines={
          page === 'Overview' ? financeSample.summary : financeSample.invoice
        }
      />
    </PreviewPage>
  );
}
