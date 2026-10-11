import React from 'react';
import { href } from '../router.js';
import { Page, Tabs, useRun } from '../ui.jsx';
import Performance from './report/Performance.jsx';
import Operations from './report/Operations.jsx';
import Findings from './report/Findings.jsx';
import { AssuranceView } from './AssurancePage.jsx';

const TABS = [
  { id: 'performance', label: 'Part 1 Business performance' },
  { id: 'ops', label: 'Part 2 Inventory & Store Brain' },
  { id: 'findings', label: 'Part 3 Diagnosis & recommendations' },
  { id: 'assurance', label: 'Part 4 Commercial assurance' },
];

export default function ReportPage({ tab }) {
  const { runId, run } = useRun();
  return (
    <Page
      title="60-Day Commercial Report"
      intro={`Every figure on these pages is calculated from the stored history of ${runId}${run?.is_submitted ? ', the Submitted Run' : ''}. Select a day, product or Store Brain event to see the records behind it.`}
    >
      <Tabs tabs={TABS} active={tab} onChange={(id) => (window.location.hash = href(runId, 'report', id))} />
      {tab === 'performance' && <Performance />}
      {tab === 'ops' && <Operations />}
      {tab === 'findings' && <Findings />}
      {tab === 'assurance' && <AssuranceView compact />}
    </Page>
  );
}
