import React, { useState, useEffect } from 'react';
import {
  Radar,
  Compass,
  MapPin,
  RotateCcw,
  Download,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Globe,
  Ruler,
  Crosshair,
  Info,
} from 'lucide-react';
import { Glass } from '../../components/primitives/Glass.tsx';

interface CameraPose {
  camera_id?: number;
  image_name?: string;
  tx?: number;
  ty?: number;
  tz?: number;
  qx?: number;
  qy?: number;
  qz?: number;
  qw?: number;
  [key: string]: any;
}

interface GeospatialData {
  mission_id: string;
  status: string;
  failed_stage?: string | null;
  failure_reason?: string | null;
  geospatial: {
    is_georeferenced: boolean;
    reference_location?: string;
    coordinate_system: string;
    scale_status: string;
    flight_path_length: string;
    coverage_area: string;
    camera_poses_count: number;
  };
  telemetry: {
    source: string;
    speed?: string;
    heading?: string;
    altitude?: string;
    coordinates?: [number, number] | null;
    precision?: string;
    raw?: any;
  };
  reconstruction: {
    status: string;
    registered_cameras: number;
    total_images: number;
    sparse_point_count: number;
    camera_poses: CameraPose[];
  };
  camera_poses: CameraPose[];
  flight_path_length: string;
  coverage_area: string;
  duration_seconds: number;
  is_georeferenced: boolean;
  reference_location?: string;
  scale_status: string;
}

export const GeospatialPage: React.FC = () => {
  const [missionsList, setMissionsList] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>('66f84733-06de-41fd-8227-ddf82b15561f');
  const [geoData, setGeoData] = useState<GeospatialData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [retrying, setRetrying] = useState<boolean>(false);
  const [geoForm, setGeoForm] = useState({
    latitude: '28.6139',
    longitude: '77.2090',
    altitude: '45.0',
    heading: '124.0',
    reference_distance_m: '',
  });
  const [applyingGeo, setApplyingGeo] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);

  // 1. Fetch available missions
  useEffect(() => {
    let active = true;
    import('../../api/missions.js').then(({ listMissions }) => {
      listMissions().then((list: any[]) => {
        if (!active || !list) return;
        setMissionsList(list);
        if (list.length > 0 && !list.some((m) => m.id === selectedId)) {
          setSelectedId(list[0].id);
        }
      });
    });
    return () => { active = false; };
  }, []);

  // 2. Fetch geospatial data for selected mission
  const fetchGeospatial = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/missions/${id}/geospatial`);
      if (res.ok) {
        const data = await res.json();
        setGeoData(data);
      } else {
        // Fallback to mission summary
        const mRes = await fetch(`/api/v1/missions/${id}`);
        if (mRes.ok) {
          const mData = await mRes.json();
          const m = mData.mission || {};
          setGeoData({
            mission_id: id,
            status: m.status || 'UNKNOWN',
            failed_stage: m.failed_stage,
            failure_reason: m.failure_reason,
            geospatial: m.geospatial || {
              is_georeferenced: false,
              coordinate_system: 'LOCAL_ARBITRARY',
              scale_status: 'RELATIVE_SCALE',
              flight_path_length: 'Not available: unreferenced local coordinates',
              coverage_area: 'Not available: georeferencing required',
              camera_poses_count: 0,
            },
            telemetry: m.telemetry || { source: 'none' },
            reconstruction: m.reconstruction || {},
            camera_poses: m.reconstruction?.camera_poses || [],
            flight_path_length: m.geospatial?.flight_path_length || 'Not available',
            coverage_area: m.geospatial?.coverage_area || 'Not available',
            duration_seconds: m.video?.duration_seconds || 0,
            is_georeferenced: m.geospatial?.is_georeferenced || false,
            reference_location: m.geospatial?.reference_location,
            scale_status: m.geospatial?.scale_status || 'RELATIVE_SCALE',
          });
        }
      }
    } catch (err: any) {
      console.warn('Could not load geospatial data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedId) {
      fetchGeospatial(selectedId);
    }
  }, [selectedId]);

  // Handle Retry Reconstruction
  const handleRetry = async () => {
    if (!selectedId) return;
    setRetrying(true);
    setNotice({ msg: 'Initiating 3D reconstruction pipeline retry...', type: 'info' });
    try {
      const res = await fetch(`/api/v1/missions/${selectedId}/reconstruct`, { method: 'POST' });
      if (res.ok) {
        setNotice({ msg: 'Reconstruction pipeline dispatched successfully. Refreshing...', type: 'success' });
        setTimeout(() => fetchGeospatial(selectedId), 2000);
      } else {
        const err = await res.json().catch(() => ({}));
        setNotice({ msg: err.detail || 'Failed to trigger reconstruction retry', type: 'error' });
      }
    } catch (err: any) {
      setNotice({ msg: err.message || 'Connection error during retry', type: 'error' });
    } finally {
      setRetrying(false);
    }
  };

  // Handle Apply Georeferencing
  const handleApplyGeoref = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    setApplyingGeo(true);
    try {
      const body = {
        latitude: parseFloat(geoForm.latitude) || null,
        longitude: parseFloat(geoForm.longitude) || null,
        altitude: parseFloat(geoForm.altitude) || null,
        heading: parseFloat(geoForm.heading) || null,
        reference_distance_m: parseFloat(geoForm.reference_distance_m) || null,
        crs: 'WGS-84',
      };
      const res = await fetch(`/api/v1/missions/${selectedId}/georeference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setNotice({ msg: 'Georeference anchor saved successfully!', type: 'success' });
        fetchGeospatial(selectedId);
      } else {
        const err = await res.json().catch(() => ({}));
        setNotice({ msg: err.detail || 'Could not update georeference anchor', type: 'error' });
      }
    } catch (err: any) {
      setNotice({ msg: err.message || 'Failed to submit georeferencing', type: 'error' });
    } finally {
      setApplyingGeo(false);
    }
  };

  // Handle GeoJSON Download
  const handleDownloadGeoJSON = () => {
    if (!geoData?.is_georeferenced) return;
    window.open(`/api/v1/missions/${selectedId}/export/geojson`, '_blank');
  };

  const isFailedOrNotRun =
    geoData?.status === 'NOT_RUN' ||
    geoData?.status === 'FAILED' ||
    geoData?.reconstruction?.status === 'NOT_RUN' ||
    geoData?.reconstruction?.status === 'FAILED';

  const regCams = geoData?.reconstruction?.registered_cameras || 0;
  const poses = geoData?.camera_poses || [];

  return (
    <div className="geospatial-layout" style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', color: 'var(--fg, #e5f3f7)' }}>
      {/* Top Header & Mission Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <Radar size={22} color="var(--cyan, #00d2ff)" />
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Geospatial Mapping & Flight Trajectory</h1>
            <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(0,210,255,0.15)', color: 'var(--cyan, #00d2ff)', border: '1px solid rgba(0,210,255,0.3)' }}>
              HEXA SPARK SPATIAL SUITE
            </span>
          </div>
          <p style={{ margin: 0, color: 'var(--dim, #91adb8)', fontSize: '0.9rem' }}>
            Real photogrammetric trajectory, ground coverage, and WGS-84 coordinate anchoring.
          </p>
        </div>

        {/* Mission Select Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--dim, #91adb8)' }}>Mission:</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{
              background: 'rgba(10, 25, 40, 0.8)',
              color: 'var(--fg, #e5f3f7)',
              border: '1px solid rgba(0,210,255,0.3)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '0.85rem',
            }}
          >
            {missionsList.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id} ({m.status || 'unknown'})
              </option>
            ))}
          </select>
        </div>
      </div>

      {notice && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '6px',
            marginBottom: '20px',
            fontSize: '0.9rem',
            background: notice.type === 'success' ? 'rgba(46, 213, 115, 0.15)' : notice.type === 'error' ? 'rgba(255, 71, 87, 0.15)' : 'rgba(0, 210, 255, 0.15)',
            border: `1px solid ${notice.type === 'success' ? '#2ed573' : notice.type === 'error' ? '#ff4757' : '#00d2ff'}`,
            color: 'var(--fg, #e5f3f7)',
          }}
        >
          {notice.msg}
        </div>
      )}

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 2fr', gap: '24px' }}>
        {/* Left Column: Flight Metrics & Georeference Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Key Photogrammetric Metrics */}
          <Glass strength={2} style={{ padding: '20px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Compass size={18} color="var(--cyan, #00d2ff)" />
              SfM Trajectory Metrics
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ padding: '10px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)' }}>Flight Path Length</span>
                <strong style={{ display: 'block', fontSize: '1rem', marginTop: '4px', color: 'var(--fg, #e5f3f7)' }}>
                  {geoData?.flight_path_length || 'Not available'}
                </strong>
                <small style={{ fontSize: '0.7rem', color: 'var(--dim, #91adb8)' }}>
                  {geoData?.scale_status === 'METRIC_SCALE' ? 'Calibrated metric' : 'Relative camera units'}
                </small>
              </div>

              <div style={{ padding: '10px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)' }}>Coverage Area</span>
                <strong style={{ display: 'block', fontSize: '1rem', marginTop: '4px', color: 'var(--fg, #e5f3f7)' }}>
                  {geoData?.coverage_area || 'Not available'}
                </strong>
                <small style={{ fontSize: '0.7rem', color: 'var(--dim, #91adb8)' }}>
                  {geoData?.is_georeferenced ? 'WGS-84 footprint' : 'Relative area box'}
                </small>
              </div>

              <div style={{ padding: '10px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)' }}>Flight Duration</span>
                <strong style={{ display: 'block', fontSize: '1rem', marginTop: '4px', color: 'var(--fg, #e5f3f7)' }}>
                  {geoData?.duration_seconds ? `${geoData.duration_seconds.toFixed(1)} s` : '—'}
                </strong>
                <small style={{ fontSize: '0.7rem', color: 'var(--dim, #91adb8)' }}>Sortie video timeline</small>
              </div>

              <div style={{ padding: '10px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)' }}>Registered Poses</span>
                <strong style={{ display: 'block', fontSize: '1rem', marginTop: '4px', color: 'var(--fg, #e5f3f7)' }}>
                  {regCams} / {geoData?.reconstruction?.total_images || '—'}
                </strong>
                <small style={{ fontSize: '0.7rem', color: 'var(--dim, #91adb8)' }}>
                  {regCams > 0 ? `${((regCams / (geoData?.reconstruction?.total_images || 1)) * 100).toFixed(0)}% registration` : 'Unregistered'}
                </small>
              </div>
            </div>

            {/* Estimated Kinematics */}
            {geoData?.telemetry?.speed && (
              <div style={{ marginTop: '16px', padding: '10px', background: 'rgba(0,210,255,0.06)', borderRadius: '6px', border: '1px solid rgba(0,210,255,0.2)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--cyan, #00d2ff)' }}>Derived Kinematics (Estimated):</span>
                <div style={{ display: 'flex', gap: '16px', marginTop: '4px', fontSize: '0.85rem' }}>
                  <span>Speed: <b>{geoData.telemetry.speed}</b></span>
                  <span>Heading: <b>{geoData.telemetry.heading}</b></span>
                </div>
              </div>
            )}
          </Glass>

          {/* Georeferencing Status & Controls */}
          <Glass strength={2} style={{ padding: '20px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Globe size={18} color="var(--cyan, #00d2ff)" />
                Georeference Anchor
              </h3>
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: geoData?.is_georeferenced ? 'rgba(46, 213, 115, 0.2)' : 'rgba(255, 165, 2, 0.2)',
                  color: geoData?.is_georeferenced ? '#2ed573' : '#ffa502',
                  border: `1px solid ${geoData?.is_georeferenced ? '#2ed573' : '#ffa502'}`,
                }}
              >
                {geoData?.is_georeferenced ? 'GEOREFERENCED' : 'UNREFERENCED'}
              </span>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--dim, #91adb8)', marginBottom: '16px' }}>
              {geoData?.is_georeferenced
                ? `Anchor: ${geoData.reference_location || 'WGS-84 coordinates verified'}`
                : 'Photogrammetric model currently resides in local arbitrary Euclidean coordinates. Anchor with ground coordinates or baseline to enable real-world GIS integration.'}
            </p>

            <form onSubmit={handleApplyGeoref} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)', display: 'block', marginBottom: '4px' }}>Center Latitude</label>
                  <input
                    type="text"
                    value={geoForm.latitude}
                    onChange={(e) => setGeoForm({ ...geoForm, latitude: e.target.value })}
                    placeholder="28.6139"
                    style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '6px', color: '#fff', fontSize: '0.85rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)', display: 'block', marginBottom: '4px' }}>Center Longitude</label>
                  <input
                    type="text"
                    value={geoForm.longitude}
                    onChange={(e) => setGeoForm({ ...geoForm, longitude: e.target.value })}
                    placeholder="77.2090"
                    style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '6px', color: '#fff', fontSize: '0.85rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)', display: 'block', marginBottom: '4px' }}>Altitude AGL (m)</label>
                  <input
                    type="text"
                    value={geoForm.altitude}
                    onChange={(e) => setGeoForm({ ...geoForm, altitude: e.target.value })}
                    placeholder="45.0"
                    style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '6px', color: '#fff', fontSize: '0.85rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)', display: 'block', marginBottom: '4px' }}>Heading (°)</label>
                  <input
                    type="text"
                    value={geoForm.heading}
                    onChange={(e) => setGeoForm({ ...geoForm, heading: e.target.value })}
                    placeholder="124.0"
                    style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '6px', color: '#fff', fontSize: '0.85rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)', display: 'block', marginBottom: '4px' }}>Reference Distance (m) [Optional]</label>
                <input
                  type="text"
                  value={geoForm.reference_distance_m}
                  onChange={(e) => setGeoForm({ ...geoForm, reference_distance_m: e.target.value })}
                  placeholder="e.g. 15.0 (for metric scale)"
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '6px', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>

              <button
                type="submit"
                disabled={applyingGeo}
                style={{
                  marginTop: '8px',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  background: 'linear-gradient(135deg, rgba(0,210,255,0.8), rgba(0,140,255,0.8))',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: applyingGeo ? 'not-allowed' : 'pointer',
                  opacity: applyingGeo ? 0.7 : 1,
                }}
              >
                {applyingGeo ? 'Applying...' : 'Apply Georeference Anchor'}
              </button>
            </form>
          </Glass>

          {/* GeoJSON Export Action */}
          <Glass strength={2} style={{ padding: '16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '0.9rem', display: 'block' }}>WGS-84 GeoJSON Export</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)' }}>
                  {geoData?.is_georeferenced
                    ? 'Export GIS trajectory layer with geographic coordinates'
                    : 'Disabled: Georeferencing required before GeoJSON export'}
                </span>
              </div>
              <button
                type="button"
                disabled={!geoData?.is_georeferenced}
                onClick={handleDownloadGeoJSON}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  background: geoData?.is_georeferenced ? 'var(--cyan, #00d2ff)' : 'rgba(255,255,255,0.1)',
                  color: geoData?.is_georeferenced ? '#001a26' : 'var(--dim, #91adb8)',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: geoData?.is_georeferenced ? 'pointer' : 'not-allowed',
                }}
              >
                <Download size={14} /> Export GeoJSON
              </button>
            </div>
          </Glass>
        </div>

        {/* Right Column: Interactive Map & Status View */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Honest Failure or Not Run State */}
          {isFailedOrNotRun && (
            <Glass strength={3} style={{ padding: '24px', borderRadius: '10px', border: '1px solid rgba(255,71,87,0.4)', background: 'rgba(255,71,87,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
                <AlertTriangle size={24} color="#ff4757" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem', color: '#ff4757', fontWeight: 600 }}>
                    {geoData?.status === 'NOT_RUN'
                      ? '3D Reconstruction Pipeline Not Executed'
                      : 'Photogrammetric Reconstruction Failed'}
                  </h3>
                  <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--dim, #91adb8)', lineHeight: 1.5 }}>
                    {geoData?.failure_reason ||
                      'COLMAP incremental structure-from-motion registered 0 cameras from this video clip. This commonly happens if the drone remained stationary (hovering) or rotated in place without lateral parallax translation.'}
                  </p>
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 14px', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--fg, #e5f3f7)', marginBottom: '14px' }}>
                    <strong>Flight & Shooting Guidance:</strong> Fly in an orbit or lawnmower grid pattern with at least 60-70% lateral overlap between frames. Avoid stationary hover-and-yaw footage for 3D SfM reconstruction.
                  </div>
                  <button
                    type="button"
                    disabled={retrying}
                    onClick={handleRetry}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      background: '#ff4757',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      cursor: retrying ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <RotateCcw size={14} className={retrying ? 'spin' : ''} />
                    {retrying ? 'Retrying Pipeline...' : 'Retry 3D Reconstruction'}
                  </button>
                </div>
              </div>
            </Glass>
          )}

          {/* Interactive Map / Fallback Visualizer */}
          <Glass strength={2} style={{ padding: '20px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', flex: 1, minHeight: '480px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MapPin size={18} color="var(--cyan, #00d2ff)" />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  {geoData?.is_georeferenced ? 'OpenStreetMap WGS-84 Sortie Map' : 'Arbitrary Local Coordinate Frame Visualizer'}
                </h3>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--dim, #91adb8)' }}>
                {poses.length > 0 ? `${poses.length} camera poses loaded` : 'No poses available'}
              </span>
            </div>

            {/* Map Container */}
            <div
              style={{
                flex: 1,
                minHeight: '380px',
                borderRadius: '8px',
                overflow: 'hidden',
                position: 'relative',
                background: '#091520',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {geoData?.is_georeferenced ? (
                /* Georeferenced: Embed OSM / Leaflet iframe or live tile layer */
                <iframe
                  title="OpenStreetMap Sortie Visualizer"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  loading="lazy"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(geoForm.longitude) - 0.005}%2C${parseFloat(geoForm.latitude) - 0.005}%2C${parseFloat(geoForm.longitude) + 0.005}%2C${parseFloat(geoForm.latitude) + 0.005}&layer=mapnik&marker=${geoForm.latitude}%2C${geoForm.longitude}`}
                />
              ) : (
                /* Unreferenced Fallback SVG Trajectory View */
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
                  <svg width="240" height="180" viewBox="-120 -90 240 180" style={{ marginBottom: '16px' }}>
                    <defs>
                      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(0,210,255,0.1)" strokeWidth="0.8" />
                      </pattern>
                    </defs>
                    <rect x="-120" y="-90" width="240" height="180" fill="url(#grid)" />
                    {/* Render relative camera poses as connected trajectory points */}
                    {poses.length > 1 ? (
                      <>
                        <polyline
                          points={poses.map((p, i) => `${(p.tx || i * 8) - 80},${(p.ty || Math.sin(i * 0.4) * 20)}`).join(' ')}
                          fill="none"
                          stroke="var(--cyan, #00d2ff)"
                          strokeWidth="2"
                        />
                        {poses.map((p, i) => (
                          <circle
                            key={i}
                            cx={(p.tx || i * 8) - 80}
                            cy={(p.ty || Math.sin(i * 0.4) * 20)}
                            r="3"
                            fill="#00d2ff"
                          />
                        ))}
                      </>
                    ) : (
                      <circle cx="0" cy="0" r="8" fill="none" stroke="rgba(0,210,255,0.4)" strokeWidth="2" strokeDasharray="3 3" />
                    )}
                  </svg>

                  <strong style={{ fontSize: '0.95rem', color: 'var(--fg, #e5f3f7)', marginBottom: '6px' }}>
                    Arbitrary Local Photogrammetric Frame
                  </strong>
                  <p style={{ maxWidth: '420px', fontSize: '0.8rem', color: 'var(--dim, #91adb8)', margin: 0, lineHeight: 1.4 }}>
                    Camera coordinates are rendered in relative SfM reconstruction space ({poses.length} poses). OpenStreetMap tile projection is suppressed until geographic GPS coordinates are anchored.
                  </p>
                </div>
              )}
            </div>
          </Glass>
        </div>
      </div>
    </div>
  );
};
