import React from 'react';
import { ScanLine } from 'lucide-react';
import { StubPage } from '../../components/common/StubPage.tsx';

export const MeasurementsPage: React.FC = () => {
  return (
    <StubPage
      title="Volumetric & Surface Measurements"
      subtitle="Point-to-point Euclidean distances, cut-and-fill stockpile volume calculations, and structural clearances with sub-millimeter precision."
      icon={ScanLine}
      sector="CALIBRATED EUCLIDEAN METRIC"
      moduleCode="MOD-VOLUMETRICS"
      telemetry={[
        { label: 'Stockpile Vol', value: '4,120 m³', subtext: 'Cut-and-fill net delta' },
        { label: 'Clearance Dist', value: '6.42 m', subtext: 'Power line to canopy' },
        { label: 'Surface Area', value: '1,840 m²', subtext: 'Triangulated mesh area' },
        { label: 'Scale Factor', value: '1.00000', subtext: 'Ground control verified' },
      ]}
    />
  );
};
