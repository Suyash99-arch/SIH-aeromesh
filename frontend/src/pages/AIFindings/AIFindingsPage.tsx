import React from 'react';
import { Sparkles } from 'lucide-react';
import { StubPage } from '../../components/common/StubPage.tsx';

export const AIFindingsPage: React.FC = () => {
  return (
    <StubPage
      title="AI Findings & Tactical Insights"
      subtitle="Automated structural damage grading, unauthorized vehicle movement alerts, and perimeter breach classification."
      icon={Sparkles}
      sector="PRIORITY FEED · 6 ACTIVE ALERTS"
      moduleCode="MOD-AI-FINDINGS"
      telemetry={[
        { label: 'High Priority', value: '2 ALERTS', subtext: 'Perimeter loitering vehicle' },
        { label: 'Medium Priority', value: '4 ALERTS', subtext: 'Surface spalling detected' },
        { label: 'Resolved Today', value: '18 ITEMS', subtext: 'Operator acknowledged' },
        { label: 'Model Confidence', value: '96.2%', subtext: 'Ensemble YOLO-SAHI' },
      ]}
    />
  );
};
