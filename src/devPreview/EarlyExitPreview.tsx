import React, { useState } from 'react';
import { PreviewCard } from './PreviewUI';
import { Button } from '../components/hiraDashboard';

const samples = [
  { state: 'Draft', detail: 'Fictional unsent appointment request.' },
  { state: 'Pending', detail: 'Fictional request awaiting school review.' },
  {
    state: 'Changes Requested',
    detail: 'Fictional reviewer asks for a clearer explanation.',
  },
  {
    state: 'Rejected',
    detail: 'Fictional decision: proposed details were not accepted.',
  },
  {
    state: 'Withdrawn',
    detail: 'Fictional Parent withdrew the pending request.',
  },
] as const;
/** No services, token, identity or writable action. Rendered only in Parent preview. */
export default function EarlyExitPreview() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <PreviewCard
        title="Early Exit · Design Preview"
        lines={[
          'FICTIONAL SAMPLE DATA · read-only',
          'Submitting an Early Exit request does not authorize the child to leave school.',
          'School policy unconfigured. No approval, QR/OTP or checkout.',
        ]}
      />
      {samples.map(sample => (
        <React.Fragment key={sample.state}>
          <PreviewCard
            title={`Fictional Early Exit · ${sample.state}`}
            lines={['Sample date: 2026-11-12']}
          />
          <Button
            title={`Preview Early Exit ${sample.state}`}
            variant="secondary"
            onPress={() => setSelected(sample.state)}
          />
          {selected === sample.state ? (
            <PreviewCard
              title="Fictional Early Exit detail"
              lines={[
                sample.detail,
                'No connected Student, Parent or Principal record. No saved changes or physical release authority.',
              ]}
            />
          ) : null}
        </React.Fragment>
      ))}
    </>
  );
}
