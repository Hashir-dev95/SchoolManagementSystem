// Child selector/record-card adaptation of faraz-audit ParentDashboard.jsx and HiraHome.jsx.
import React, { useState } from 'react';
import { PreviewPage, PreviewCard, PreviewTabs } from './PreviewUI';
import { childSamples } from './previewData';

export default function ParentPreview() {
  const [child, setChild] = useState<string>(childSamples[0]);
  return (
    <PreviewPage role="Parent" title="Watching them grow is the best part.">
      <PreviewTabs items={childSamples} selected={child} onSelect={setChild} />
      <PreviewCard
        title={child}
        lines={[
          'Fictional child · no connected student record',
          child === childSamples[0]
            ? 'Mathematics · Fractions practice'
            : 'English · Reading practice',
        ]}
      />
      <PreviewCard
        title="School story"
        lines={['Sample teacher feedback', 'A little learning, every day.']}
      />
    </PreviewPage>
  );
}
