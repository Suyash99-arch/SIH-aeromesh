import React, { useState, useEffect, useRef } from "react";
import Icon from "../ui/Icon";
import {
  createMission,
  uploadVideo,
  processVideo,
  getComputeDevice,
} from "../../api/missions";
import "./NewIncidentWorkspace.css";

/**
 * Restructured New Analysis / Incident Creation Workspace
 * Matching Reference Screenshot 3 layout:
 * - Left/Center: Incident Details form + Side-by-Side Video Upload & Video Preview
 * - Right Rail: Incident Information summary card + Quick Actions (Save as Draft, Clear All, Launch)
 * - 100% Offline-safe with zero external geocoding dependencies
 */
export default function NewIncidentWorkspace({ onClose, onMissionCreated, currentUser, notice }) {
  // Auto-generate Incident ID
  const [incidentId, setIncidentId] = useState(() => {
    const yr = new Date().getFullYear();
    const rnd = Math.floor(1000 + Math.random() * 9000);
    return `INC-${yr}-${rnd}`;
  });

  const [formData, setFormData] = useState({
    name: "",
    location: "Sector 04 — Northern Perimeter (37.7749° N, 122.4194° W)",
    description: "Rapid single-pass aerial survey over damaged infrastructure for real-time 3D photogrammetry and survivor search.",
    dateTime: new Date().toISOString().slice(0, 16),
    missionType: "single-pass",
    operator: currentUser?.full_name || "Tactical Field Operator",
  });

  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [computeDevice, setComputeDevice] = useState(null);
  const fileInputRef = useRef(null);

  // Fetch real hardware device info from backend
  useEffect(() => {
    let active = true;
    getComputeDevice().then((dev) => {
      if (active && dev) setComputeDevice(dev);
    });
    return () => {
      active = false;
    };
  }, []);

  // Update video preview when file is selected
  useEffect(() => {
    if (!videoFile) {
      setVideoPreviewUrl(null);
      setVideoMeta(null);
      return;
    }
    const url = URL.createObjectURL(videoFile);
    setVideoPreviewUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [videoFile]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileSelect = (file) => {
    if (!file) return;
    if (!file.type.startsWith("video/") && !file.name.match(/\.(mp4|mov|avi|mkv)$/i)) {
      alert("Please select a valid video file (MP4, MOV, MKV).");
      return;
    }
    setVideoFile(file);
    setVideoMeta({
      name: file.name,
      size: (file.size / (1024 * 1024)).toFixed(1) + " MB",
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleClearAll = () => {
    setFormData({
      name: "",
      location: "",
      description: "",
      dateTime: new Date().toISOString().slice(0, 16),
      missionType: "single-pass",
      operator: currentUser?.full_name || "",
    });
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setVideoMeta(null);
    const yr = new Date().getFullYear();
    const rnd = Math.floor(1000 + Math.random() * 9000);
    setIncidentId(`INC-${yr}-${rnd}`);
  };

  const handleSaveDraft = async () => {
    if (!formData.name.trim()) {
      alert("Please provide at least an Incident Name to save a draft.");
      return;
    }
    setIsSubmitting(true);
    setStatusMessage("Saving incident draft...");
    try {
      const missionPayload = {
        name: formData.name,
        missionType: formData.missionType,
        location: formData.location,
        operator: formData.operator,
        description: formData.description,
        incident_id: incidentId,
      };
      const created = await createMission(missionPayload);
      if (videoFile && created?.id) {
        await uploadVideo(created.id, videoFile);
      }
      notice?.("Incident saved as draft.", "success");
      onClose?.();
    } catch (err) {
      alert("Failed to save draft: " + err.message);
    } finally {
      setIsSubmitting(false);
      setStatusMessage("");
    }
  };

  const handleLaunchPipeline = async (e) => {
    e?.preventDefault();
    if (!formData.name.trim()) {
      alert("Incident Name is required.");
      return;
    }
    if (!videoFile) {
      alert("Please upload a drone flight video before authorizing the pipeline.");
      return;
    }

    setIsSubmitting(true);
    setStatusMessage("Creating incident record in database...");
    try {
      const missionPayload = {
        name: formData.name,
        missionType: formData.missionType,
        location: formData.location,
        operator: formData.operator,
        description: formData.description,
        incident_id: incidentId,
      };

      const created = await createMission(missionPayload);
      const missionId = created.id;

      setStatusMessage("Uploading drone video footage...");
      await uploadVideo(missionId, videoFile);

      setStatusMessage("Authorizing 8-stage photogrammetric pipeline...");
      await processVideo(missionId, {
        frameSampling: 2,
        inferenceResolution: 640,
        detectionConfidence: 0.35,
        reconstructionQuality: "medium",
        sceneProfile: "road",
      });

      notice?.("Pipeline initiated! Streaming progress...", "success");
      if (onMissionCreated) {
        onMissionCreated(missionId);
      }
    } catch (err) {
      alert("Pipeline launch error: " + err.message);
      setIsSubmitting(false);
      setStatusMessage("");
    }
  };

  return (
    <div className="incident-workspace-modal-backdrop" onClick={onClose}>
      <div
        className="incident-workspace-container glass"
        onClick={(e) => e.stopPropagation()}
        id="incident-creation-workspace"
      >
        <div className="glass-sheen" aria-hidden="true" />

        {/* Modal Topbar Header */}
        <div className="incident-workspace-header">
          <div className="incident-header-left">
            <div className="glowing-icon-circle">
              <Icon name="Plus" size={20} />
            </div>
            <div>
              <div className="incident-header-badge">
                <span className="pulse-dot-cyan" />
                <span>NEW INCIDENT WORKSPACE · DISASTER RESPONSE</span>
              </div>
              <h2 className="incident-header-title">Create Incident & Analyze Footage</h2>
            </div>
          </div>

          <button
            type="button"
            className="incident-close-btn"
            onClick={onClose}
            aria-label="Close workspace"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Main 2-Column Body (Left: Details & Video, Right: Information & Actions) */}
        <div className="incident-workspace-grid">
          {/* Left Column: Incident Details Form & Upload/Preview */}
          <div className="incident-main-col">
            {/* 1. Incident Details Section */}
            <div className="incident-section-card glass">
              <div className="section-card-header">
                <Icon name="FileText" size={16} />
                <h3>Incident Details</h3>
              </div>

              <div className="incident-form-grid">
                <div className="form-field">
                  <label htmlFor="inc-name">Incident Title / Name *</label>
                  <input
                    id="inc-name"
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="e.g., North Ridge — Flash Flood Reconnaissance"
                    required
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="inc-id">Incident ID (Auto-Generated)</label>
                  <div className="inc-id-input-wrap">
                    <input
                      id="inc-id"
                      type="text"
                      value={incidentId}
                      readOnly
                      className="input-readonly mono"
                    />
                    <span className="inc-id-tag">SYSTEM AUTO</span>
                  </div>
                </div>

                <div className="form-field form-field-full">
                  <label htmlFor="inc-location">
                    Incident Location (Offline Tactical Input)
                    <span className="field-hint">Manual coordinates, sector code, or landmark</span>
                  </label>
                  <div className="location-input-wrap">
                    <Icon name="MapPin" size={15} className="location-icon" />
                    <input
                      id="inc-location"
                      type="text"
                      name="location"
                      value={formData.location}
                      onChange={handleInputChange}
                      placeholder="e.g., Sector 04, North Approach (37.7749° N, 122.4194° W)"
                    />
                  </div>
                </div>

                <div className="form-field form-field-full">
                  <label htmlFor="inc-desc">Incident Description & Objectives</label>
                  <textarea
                    id="inc-desc"
                    name="description"
                    rows={2}
                    value={formData.description}
                    onChange={handleInputChange}
                    placeholder="Describe environmental conditions, flight objectives, and tactical hazards..."
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="inc-datetime">Date & Time of Capture</label>
                  <input
                    id="inc-datetime"
                    type="datetime-local"
                    name="dateTime"
                    value={formData.dateTime}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="inc-operator">Assigned Operator / Team</label>
                  <input
                    id="inc-operator"
                    type="text"
                    name="operator"
                    value={formData.operator}
                    onChange={handleInputChange}
                    placeholder="Operator callsign or squad identifier"
                  />
                </div>
              </div>
            </div>

            {/* 2. Side-by-Side Video Upload & Video Preview Section */}
            <div className="incident-section-card glass">
              <div className="section-card-header">
                <Icon name="Video" size={16} />
                <h3>Drone Video Ingestion & Synchronized Preview</h3>
              </div>

              <div className="video-upload-preview-grid">
                {/* Drag-and-Drop Zone */}
                <div
                  className={`video-dropzone ${isDragging ? "dragging" : ""} ${videoFile ? "has-file" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/x-matroska,.mp4,.mov,.mkv"
                    style={{ display: "none" }}
                    onChange={(e) => handleFileSelect(e.target.files?.[0])}
                  />

                  <div className="dropzone-content">
                    <div className="dropzone-icon-circle">
                      <Icon name="UploadCloud" size={24} />
                    </div>
                    <h4>{videoFile ? "Replace Video Footage" : "Drag & Drop Drone Footage"}</h4>
                    <p>Supports MP4, MOV, or MKV captured by aerial drones</p>
                    <button type="button" className="btn-browse-file">
                      <Icon name="Folder" size={14} />
                      <span>{videoFile ? "Choose Different Video" : "Browse Local File"}</span>
                    </button>
                    {videoMeta && (
                      <div className="selected-file-badge">
                        <Icon name="CheckCircle2" size={14} color="#4ee38a" />
                        <span className="file-name">{videoMeta.name}</span>
                        <span className="file-size">({videoMeta.size})</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Live Video Preview Player */}
                <div className="video-preview-card">
                  {videoPreviewUrl ? (
                    <div className="video-player-frame">
                      <video
                        src={videoPreviewUrl}
                        controls
                        className="live-video-preview"
                        preload="metadata"
                      />
                      <div className="preview-statusbar">
                        <span className="preview-indicator">
                          <span className="dot-green" /> STREAM READY
                        </span>
                        <span className="preview-meta">{videoMeta?.name}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="video-preview-placeholder">
                      <Icon name="Film" size={32} />
                      <p>Video preview will appear here immediately upon selection</p>
                      <span className="placeholder-subtext">Hardware decoder active · Offline safe</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Rail: Incident Information Summary Card & Quick Actions */}
          <div className="incident-rail-col">
            {/* Incident Summary Card */}
            <div className="rail-summary-card glass">
              <div className="rail-card-header">
                <Icon name="Info" size={16} />
                <h4>Incident Information</h4>
              </div>

              <div className="rail-info-list">
                <div className="rail-info-row">
                  <span className="info-label">Incident ID</span>
                  <span className="info-value mono cyan">{incidentId}</span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">Title</span>
                  <span className="info-value">{formData.name || "—"}</span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">Location</span>
                  <span className="info-value text-truncate">{formData.location || "Offline / Unset"}</span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">Operator</span>
                  <span className="info-value">{formData.operator || "Anonymous"}</span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">Target File</span>
                  <span className="info-value text-truncate">{videoMeta ? videoMeta.name : "Awaiting footage"}</span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">File Size</span>
                  <span className="info-value mono">{videoMeta ? videoMeta.size : "0.0 MB"}</span>
                </div>
              </div>

              {/* Hardware Authorization Insight */}
              <div className="hardware-spec-box">
                <div className="hw-header">
                  <Icon name="Cpu" size={14} color="var(--cyan)" />
                  <span>Compute Engine Authorization</span>
                </div>
                <div className="hw-content">
                  <div className="hw-spec-row">
                    <span>Hardware:</span>
                    <strong>{computeDevice?.device_name || "Intel(R) Graphics"}</strong>
                  </div>
                  <div className="hw-spec-row">
                    <span>Inference Path:</span>
                    <span>{computeDevice?.cuda_available ? "NVIDIA TensorRT GPU" : "CPU Multi-Threading"}</span>
                  </div>
                  <div className="hw-spec-row">
                    <span>Est. Pipeline Time:</span>
                    <strong className="cyan">{computeDevice?.estimated_duration || "~6 – 8 min"}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions Card */}
            <div className="rail-actions-card glass">
              <div className="rail-card-header">
                <Icon name="Zap" size={16} />
                <h4>Quick Actions</h4>
              </div>

              <div className="quick-actions-btns">
                <button
                  type="button"
                  className="action-btn action-draft"
                  onClick={handleSaveDraft}
                  disabled={isSubmitting}
                >
                  <Icon name="Save" size={14} />
                  <span>Save as Draft</span>
                </button>

                <button
                  type="button"
                  className="action-btn action-clear"
                  onClick={handleClearAll}
                  disabled={isSubmitting}
                >
                  <Icon name="Trash2" size={14} />
                  <span>Clear All</span>
                </button>

                <button
                  type="button"
                  className="action-btn action-launch"
                  onClick={handleLaunchPipeline}
                  disabled={isSubmitting || !videoFile}
                  id="btn-launch-incident-pipeline"
                >
                  <Icon name={isSubmitting ? "Loader2" : "Rocket"} size={16} className={isSubmitting ? "spin" : ""} />
                  <span>{isSubmitting ? "Authorizing Pipeline..." : "Authorize & Launch Pipeline"}</span>
                </button>
              </div>

              {statusMessage && (
                <div className="status-progress-text">
                  <span className="pulse-dot-cyan" />
                  <span>{statusMessage}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
