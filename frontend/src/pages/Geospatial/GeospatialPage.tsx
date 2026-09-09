import React from 'react';
import { Radar } from 'lucide-react';
import { StubPage } from '../../components/common/StubPage.tsx';

export const GeospatialPage: React.FC = () => {
  return (
    <StubPage
      title="Geospatial Mapping"
      subtitle="WGS-84 / UTM geo-referenced point coordinate anchoring, digital elevation modeling (DEM), and orthophoto tile generation."
      icon={Radar}
      sector="UTM ZONE 43N · WGS-84"
      moduleCode="MOD-GEO-ANCHOR"
      telemetry={[
        { label: 'GPS Precision', value: '±0.04 m', subtext: 'RTK dual-antenna lock' },
        { label: 'DEM Resolution', value: '1.2 cm/px', subtext: 'Ground sampling distance' },
        { label: 'Coverage Area', value: '42,500 m²', subtext: 'Single drone sortie' },
        { label: 'Elevation Delta', value: '18.4 m', subtext: 'Terrain height variance' },
      ]}
    />
  );
};
