import React, { useState, useEffect, useRef } from "react";
import Icon from "../ui/Icon";
import { useUI } from "../../context/UIContext";
import {
  createMission,
  uploadVideo,
  uploadVideoChunk,
  processVideo,
  getComputeDevice,
  estimatePipelineEtaApi,
} from "../../api/missions";
import { formatApiError } from "../../utils/errorUtils";
import "./NewIncidentWorkspace.css";

/**
 * Restructured New Analysis / Incident Creation Workspace
 * Matching Reference Screenshot 3 layout:
 * - Left/Center: Incident Details form + Side-by-Side Video Upload & Video Preview
 * - Right Rail: Incident Information summary card + Quick Actions (Save as Draft, Clear All, Launch)
 * - 100% Offline-safe with zero external geocoding dependencies
 */
export default function NewIncidentWorkspace({ onClose, onMissionCreated, currentUser, notice }) {
  const { t } = useUI();
  const getLocalDatetimeString = (d = new Date()) => {
    const pad = (n) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Live real-time clock state
  const [liveTime, setLiveTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-generate Incident ID
  const [incidentId, setIncidentId] = useState(() => {
    const yr = new Date().getFullYear();
    const rnd = Math.floor(1000 + Math.random() * 9000);
    return `INC-${yr}-${rnd}`;
  });

  const [formData, setFormData] = useState({
    name: "",
    location: "",
    description: "",
    dateTime: getLocalDatetimeString(new Date()),
    missionType: "single-pass",
    operator: currentUser?.full_name || "",
  });

  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [computeDevice, setComputeDevice] = useState(null);
  const [createdMissionId, setCreatedMissionId] = useState(null);
  const [etaDetails, setEtaDetails] = useState(null);
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

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState("0.0");
  const [errorMessage, setErrorMessage] = useState("");
  const abortControllerRef = useRef(null);

  const updateEtaEstimate = async (file, width = 1920, height = 1080, duration = 30.0) => {
    if (!file) return;
    const sizeBytes = file.size || 0;
    try {
      const res = await estimatePipelineEtaApi({
        width,
        height,
        duration_seconds: duration,
        size_bytes: sizeBytes,
        frame_sampling: 2.0,
        fps: 30.0,
      });
      if (res) {
        setEtaDetails(res);
      }
    } catch (err) {
      console.warn("ETA estimation warning:", err);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileSelect = (file) => {
    setErrorMessage("");
    if (!file) return;
    if (!file.type.startsWith("video/") && !file.name.match(/\.(mp4|mov|avi|mkv)$/i)) {
      setErrorMessage("Please select a valid drone video file (MP4, MOV, MKV).");
      return;
    }
    setVideoFile(file);
    setVideoMeta({
      name: file.name,
      size: (file.size / (1024 * 1024)).toFixed(1) + " MB",
    });
    updateEtaEstimate(file);
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
      dateTime: getLocalDatetimeString(new Date()),
      missionType: "single-pass",
      operator: currentUser?.full_name || "",
    });
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setVideoMeta(null);
    setCreatedMissionId(null);
    setEtaDetails(null);
    setErrorMessage("");
    setUploadProgress(0);
    setUploadSpeed("0.0");
    const yr = new Date().getFullYear();
    const rnd = Math.floor(1000 + Math.random() * 9000);
    setIncidentId(`INC-${yr}-${rnd}`);
  };

  const handleSaveDraft = async () => {
    setErrorMessage("");
    if (!formData.name.trim()) {
      setErrorMessage("Please provide at least an Incident Name to save a draft.");
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
      setErrorMessage("Failed to save draft: " + formatApiError(err));
    } finally {
      setIsSubmitting(false);
      setStatusMessage("");
    }
  };

  const handleCancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsSubmitting(false);
    setStatusMessage("");
  };

  const handleRetryProcessing = async () => {
    if (!createdMissionId) return;
    setIsSubmitting(true);
    setErrorMessage("");
    setStatusMessage("Retrying pipeline processing (re-using uploaded footage)...");
    try {
      await processVideo(createdMissionId, {
        frameSampling: 2,
        inferenceResolution: 640,
        detectionConfidence: 0.35,
        reconstructionQuality: "medium",
        sceneProfile: "road",
      });
      notice?.("Pipeline initiated! Streaming progress...", "success");
      if (onMissionCreated) {
        onMissionCreated(createdMissionId);
      }
    } catch (err) {
      setErrorMessage(formatApiError(err));
      setIsSubmitting(false);
      setStatusMessage("");
    }
  };

  const handleLaunchPipeline = async (e) => {
    e?.preventDefault();
    setErrorMessage("");
    if (!formData.name.trim()) {
      setErrorMessage("Incident Name is required.");
      return;
    }
    if (!videoFile) {
      setErrorMessage("Please upload a drone flight video before authorizing the pipeline.");
      return;
    }

    setIsSubmitting(true);
    setStatusMessage("Creating incident record in database...");
    abortControllerRef.current = new AbortController();

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
      setCreatedMissionId(missionId);

      setStatusMessage("Uploading drone video footage...");
      try {
        await uploadVideoChunk(
          missionId,
          videoFile,
          (info) => {
            setUploadProgress(info.progress);
            setUploadSpeed(info.speedMBps);
            if (info.isFinalizing || info.chunkIndex === info.totalChunks) {
              setStatusMessage(`Assembling footage & validating codecs on server (${info.progress}%)...`);
            } else {
              setStatusMessage(`Uploading chunk ${info.chunkIndex}/${info.totalChunks} (${info.progress}% @ ${info.speedMBps} MB/s)...`);
            }
          },
          abortControllerRef.current.signal
        );
      } catch (chunkErr) {
        if (chunkErr.name === "AbortError" || chunkErr.message?.includes("cancelled")) {
          throw chunkErr;
        }
        console.warn("Chunked upload failed, falling back to direct upload:", chunkErr);
        setStatusMessage("Chunk upload interrupted; falling back to direct upload...");
        await uploadVideo(missionId, videoFile);
      }

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
      if (err.name === "AbortError" || err.message?.includes("cancelled")) {
        setErrorMessage("Upload cancelled by operator.");
      } else {
        setErrorMessage(formatApiError(err) || "Pipeline launch error.");
      }
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
                <span>{t("newMission.workspaceBadge")}</span>
              </div>
              <h2 className="incident-header-title">{t("newMission.workspaceTitle")}</h2>
            </div>
          </div>

          <button
            type="button"
            className="incident-close-btn"
            onClick={onClose}
            aria-label={t("newMission.closeWorkspace")}
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Main 2-Column Body (Left: Details & Video, Right: Information & Actions) */}
        <div className="incident-workspace-grid">
          {/* Left Column: Incident Details Form & Upload/Preview */}
          <div className="incident-main-col">
            {errorMessage && (
              <div
                style={{
                  background: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.35)",
                  borderRadius: "10px",
                  padding: "16px",
                  marginBottom: "16px",
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                }}
              >
                <div style={{ color: "#ef4444", fontSize: "20px", lineHeight: "1" }}>⚠</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#f87171", fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>
                    {errorMessage.includes("worker not connected") || errorMessage.includes("Worker")
                      ? t("newMission.workerDisconnected")
                      : t("newMission.submissionError")}
                  </div>
                  <div style={{ color: "#cbd5e1", fontSize: "13px", lineHeight: "1.5" }}>
                    {errorMessage}
                  </div>

                  {createdMissionId && (
                    <div style={{ marginTop: "12px" }}>
                      <button
                        type="button"
                        onClick={handleRetryProcessing}
                        disabled={isSubmitting}
                        id="btn-retry-pipeline-processing"
                        style={{
                          background: "#0284c7",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "6px",
                          padding: "8px 16px",
                          fontWeight: 600,
                          fontSize: "13px",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "8px",
                          boxShadow: "0 2px 8px rgba(2, 132, 199, 0.4)",
                        }}
                      >
                        <Icon name="RotateCcw" size={14} />
                        <span>{t("newMission.retryPipelineKeepVideo")}</span>
                      </button>
                    </div>
                  )}

                  {(errorMessage.includes("worker not connected") || errorMessage.includes("Worker")) && (
                    <div
                      style={{
                        marginTop: "10px",
                        background: "rgba(0, 0, 0, 0.4)",
                        borderRadius: "6px",
                        padding: "10px 12px",
                        fontSize: "12px",
                        fontFamily: "monospace",
                        color: "#94a3b8",
                        borderLeft: "3px solid #38bdf8",
                      }}
                    >
                      <strong style={{ color: "#38bdf8", display: "block", marginBottom: "4px" }}>
                        {t("newMission.tunnelHelpTitle")}
                      </strong>
                      1. Start worker: <code style={{ color: "#f1f5f9" }}>python -m uvicorn backend.main:app --port 8001</code> with PIPELINE_ENABLED=true<br />
                      2. Expose tunnel: <code style={{ color: "#f1f5f9" }}>cloudflared tunnel --url http://localhost:8001</code><br />
                      3. Configure API: Set <code style={{ color: "#f1f5f9" }}>WORKER_URL=https://&lt;tunnel-id&gt;.trycloudflare.com</code>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 1. Incident Details Section */}
            <div className="incident-section-card glass">
              <div className="section-card-header">
                <Icon name="FileText" size={16} />
                <h3>{t("newMission.incidentDetails")}</h3>
              </div>

              <div className="incident-form-grid">
                <div className="form-field">
                  <label htmlFor="inc-name">{t("newMission.incidentTitle")}</label>
                  <input
                    id="inc-name"
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder={t("newMission.incidentTitlePlaceholder")}
                    required
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="inc-id">{t("newMission.incidentId")}</label>
                  <div className="inc-id-input-wrap">
                    <input
                      id="inc-id"
                      type="text"
                      value={incidentId}
                      readOnly
                      className="input-readonly mono"
                    />
                    <span className="inc-id-tag">{t("newMission.systemAuto")}</span>
                  </div>
                </div>

                <div className="form-field form-field-full">
                  <label htmlFor="inc-location">
                    {t("newMission.incidentLocation")}
                    <span className="field-hint">{t("newMission.locationHint")}</span>
                  </label>
                  <div className="location-input-wrap">
                    <Icon name="MapPin" size={15} className="location-icon" />
                    <input
                      id="inc-location"
                      type="text"
                      name="location"
                      value={formData.location}
                      onChange={handleInputChange}
                      placeholder={t("newMission.locationPlaceholder")}
                    />
                  </div>
                </div>

                <div className="form-field form-field-full">
                  <label htmlFor="inc-desc">{t("newMission.incidentDesc")}</label>
                  <textarea
                    id="inc-desc"
                    name="description"
                    rows={2}
                    value={formData.description}
                    onChange={handleInputChange}
                    placeholder={t("newMission.descPlaceholder")}
                  />
                </div>

                <div className="form-field form-field-datetime">
                  <div className="datetime-label-row">
                    <label htmlFor="inc-datetime">{t("newMission.captureDateTime")}</label>
                    <button
                      type="button"
                      className="live-sync-btn"
                      onClick={() => {
                        setFormData((prev) => ({
                          ...prev,
                          dateTime: getLocalDatetimeString(new Date()),
                        }));
                      }}
                      title={t("newMission.liveSyncTitle")}
                    >
                      <span className="live-clock-dot" />
                      <span>{t("newMission.liveSyncNow")}</span>
                    </button>
                  </div>
                  <div className="datetime-input-wrap">
                    <input
                      id="inc-datetime"
                      type="datetime-local"
                      name="dateTime"
                      value={formData.dateTime}
                      onChange={handleInputChange}
                    />
                    <div className="live-time-ticker">
                      <span className="ticker-label">{t("newMission.currentRealTime")}</span>
                      <span className="ticker-val mono">
                        {liveTime.toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "2-digit",
                        })}{" "}
                        {liveTime.toLocaleTimeString(undefined, {
                          hour12: false,
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="form-field">
                  <label htmlFor="inc-operator">{t("newMission.assignedOperator")}</label>
                  <input
                    id="inc-operator"
                    type="text"
                    name="operator"
                    value={formData.operator}
                    onChange={handleInputChange}
                    placeholder={t("newMission.operatorPlaceholder")}
                  />
                </div>
              </div>
            </div>

            {/* 2. Side-by-Side Video Upload & Video Preview Section */}
            <div className="incident-section-card glass">
              <div className="section-card-header">
                <Icon name="Video" size={16} />
                <h3>{t("newMission.videoIngestion")}</h3>
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
                    id="inc-video-file-input"
                    type="file"
                    accept="video/mp4,video/quicktime,video/x-matroska,.mp4,.mov,.mkv"
                    style={{ display: "none" }}
                    onChange={(e) => handleFileSelect(e.target.files?.[0])}
                  />

                  <div className="dropzone-content">
                    <div className="dropzone-icon-circle">
                      <Icon name="UploadCloud" size={24} />
                    </div>
                    <h4>{videoFile ? t("newMission.replaceFootage") : t("newMission.dragDropFootage")}</h4>
                    <p>{t("newMission.supportsFormats")}</p>
                    <button type="button" className="btn-browse-file">
                      <Icon name="Folder" size={14} />
                      <span>{videoFile ? t("newMission.chooseDifferent") : t("newMission.browseLocal")}</span>
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
                        onLoadedMetadata={(e) => {
                          const w = e.target.videoWidth || 1920;
                          const h = e.target.videoHeight || 1080;
                          const dur = e.target.duration || 30.0;
                          updateEtaEstimate(videoFile, w, h, dur);
                        }}
                      />
                      <div className="preview-statusbar">
                        <span className="preview-indicator">
                          <span className="dot-green" /> {t("newMission.streamReady")}
                        </span>
                        <span className="preview-meta">{videoMeta?.name}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="video-preview-placeholder">
                      <Icon name="Film" size={32} />
                      <p>{t("newMission.previewPlaceholder")}</p>
                      <span className="placeholder-subtext">{t("newMission.hardwareDecoderActive")}</span>
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
                <h4>{t("newMission.incidentInformation")}</h4>
              </div>

              <div className="rail-info-list">
                <div className="rail-info-row">
                  <span className="info-label">{t("newMission.incidentIdLabel")}</span>
                  <span className="info-value mono cyan">{incidentId}</span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">{t("newMission.titleLabel")}</span>
                  <span className="info-value">{formData.name || "—"}</span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">{t("newMission.locationLabel")}</span>
                  <span className="info-value text-truncate">{formData.location || t("newMission.offlineUnset")}</span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">{t("newMission.operatorLabel")}</span>
                  <span className="info-value">{formData.operator || t("newMission.anonymous")}</span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">{t("newMission.captureTimeLabel")}</span>
                  <span className="info-value mono cyan" style={{ fontSize: "11px" }}>
                    {formData.dateTime ? formData.dateTime.replace("T", " ") : t("newMission.realTime")}
                  </span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">{t("newMission.targetFileLabel")}</span>
                  <span className="info-value text-truncate">{videoMeta ? videoMeta.name : t("newMission.awaitingFootage")}</span>
                </div>
                <div className="rail-info-row">
                  <span className="info-label">{t("newMission.fileSizeLabel")}</span>
                  <span className="info-value mono">{videoMeta ? videoMeta.size : "0.0 MB"}</span>
                </div>
              </div>

              {/* Hardware Authorization Insight */}
              <div className="hardware-spec-box">
                <div className="hw-header">
                  <Icon name="Cpu" size={14} color="var(--cyan)" />
                  <span>{t("newMission.computeAuthorization")}</span>
                </div>
                <div className="hw-content">
                  <div className="hw-spec-row">
                    <span>{t("newMission.hardwareLabel")}</span>
                    <strong>{computeDevice?.device_name || "Host Processor"}</strong>
                  </div>
                  <div className="hw-spec-row">
                    <span>{t("newMission.inferencePathLabel")}</span>
                    <span>{computeDevice?.cuda_available ? "NVIDIA TensorRT GPU" : "CPU Multi-Threading"}</span>
                  </div>
                  <div className="hw-spec-row">
                    <span>{t("newMission.estPipelineTime")}</span>
                    <strong className="cyan">
                      {etaDetails?.eta_range_human || etaDetails?.eta_human || computeDevice?.estimated_duration || "~6 – 8 min"}
                    </strong>
                  </div>

                  {etaDetails && (
                    <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px dashed rgba(255,255,255,0.15)", fontSize: "11px", color: "#94a3b8" }}>
                      <div style={{ fontWeight: 600, color: "#38bdf8", marginBottom: "4px" }}>{t("newMission.etaFormulaInputs")}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                        <span>{t("newMission.keyframesLabel")} <strong style={{ color: "#f8fafc" }}>{etaDetails.keyframe_count || 120}</strong></span>
                        <span>{t("newMission.megapixelsLabel")} <strong style={{ color: "#f8fafc" }}>{etaDetails.input_megapixels || "—"} MP</strong></span>
                        <span>{t("newMission.throughputLabel")} <strong style={{ color: "#f8fafc" }}>{etaDetails.effective_throughput_mpix_s ? `${etaDetails.effective_throughput_mpix_s} MP/s` : "—"}</strong></span>
                        <span>{t("newMission.confidenceLabel")} <strong style={{ color: "#4ee38a" }}>{etaDetails.confidence_percent ? `${etaDetails.confidence_percent}%` : "—"}</strong></span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Actions Card */}
            <div className="rail-actions-card glass">
              <div className="rail-card-header">
                <Icon name="Zap" size={16} />
                <h4>{t("newMission.quickActions")}</h4>
              </div>

              <div className="quick-actions-btns">
                <button
                  type="button"
                  className="action-btn action-draft"
                  onClick={handleSaveDraft}
                  disabled={isSubmitting}
                >
                  <Icon name="Save" size={14} />
                  <span>{t("newMission.saveDraft")}</span>
                </button>

                <button
                  type="button"
                  className="action-btn action-clear"
                  onClick={handleClearAll}
                  disabled={isSubmitting}
                >
                  <Icon name="Trash2" size={14} />
                  <span>{t("newMission.clearAll")}</span>
                </button>

                <button
                  type="button"
                  className="action-btn action-launch"
                  onClick={handleLaunchPipeline}
                  disabled={isSubmitting || !videoFile}
                  id="btn-launch-incident-pipeline"
                >
                  <Icon name={isSubmitting ? "Loader2" : "Rocket"} size={16} className={isSubmitting ? "spin" : ""} />
                  <span>{isSubmitting ? t("newMission.authorizingPipeline") : t("newMission.authorizeLaunch")}</span>
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
