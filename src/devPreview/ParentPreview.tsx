// Child selector/record-card adaptation of faraz-audit ParentDashboard.jsx and HiraHome.jsx.
import React, { useState } from 'react';
import { PreviewPage, PreviewCard, PreviewTabs } from './PreviewUI';
import { childSamples, pickupPreviewSamples } from './previewData';
import { Button } from '../components/hiraDashboard';

export default function ParentPreview() {
  const [child, setChild] = useState<string>(childSamples[0]);
  const [pickup, setPickup] = useState<string | null>(null);
  return (
    <PreviewPage role="Parent" title="Watching them grow is the best part.">
      <PreviewTabs
        items={childSamples}
        selected={child}
        onSelect={value => {
          setChild(value);
          setPickup(null);
        }}
      />
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
      <PreviewCard
        title="Pickup Persons · Design Preview"
        lines={[
          'FICTIONAL SAMPLE DATA · read-only',
          'School verification unavailable. Pickup permission inactive.',
          'Policy-blocked approval: no school-approved identity or custody policy.',
          'These examples are not gate passes.',
        ]}
      />
      {pickupPreviewSamples.map(sample => (
        <React.Fragment key={sample.name}>
          <PreviewCard
            title={`${sample.name} · ${sample.state}`}
            lines={[sample.relationship, 'Sample validity · 2026-11-09 – 2026-11-13']}
          />
          <Button
            title={`Preview ${sample.name}`}
            variant="secondary"
            onPress={() => setPickup(sample.name)}
          />
          {pickup === sample.name ? (
            <PreviewCard
              title="Fictional pickup detail"
              lines={[
                sample.detail,
                `Sample child · ${child}`,
                'Identity: unverified · custody: unknown',
                'Approve unavailable — school policy required',
                'Design Preview only. No API connection, saved changes or physical collection authority.',
              ]}
            />
          ) : null}
        </React.Fragment>
      ))}
    </PreviewPage>
  );
}
