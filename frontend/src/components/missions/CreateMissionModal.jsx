import { useState, useCallback } from "react";
import "./CreateMissionModal.css";
import {
  createMission,
  uploadVideo,
  processVideo,
  generateReconstruction,
} from "../../api/missions";
import MissionSetupForm from "./MissionSetupForm";
import VideoUploadForm from "./VideoUploadForm";
import ProcessingConfigForm from "./ProcessingConfigForm";

/**
 * Multi-step mission creation workflow
 * Steps:
 * 1. Mission Setup - Basic info
 * 2. Video Ingestion - Upload drone video
 * 3. Processing Config - Set parameters
 * 4. Start Processing - Begin analysis
 */
export default function CreateMissionModal({ onClose, onMissionCreated }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mission, setMission] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [processingConfig, setProcessingConfig] = useState({
    frameSampling: 2,
    inferenceResolution: 640,
    detectionConfidence: 0.35,
    reconstructionQuality: "medium",
  });

  const handleStepOneSubmit = useCallback(async (formData) => {
    setLoading(true);
    setError(null);
    try {
      const newMission = await createMission(formData);
      setMission(newMission);
      setCurrentStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleVideoUpload = useCallback(
    async (file) => {
      setLoading(true);
      setError(null);
      try {
        setVideoFile(file);
        await uploadVideo(mission.id, file);
        setCurrentStep(3);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [mission],
  );

  const handleProcessingConfig = useCallback((config) => {
    setProcessingConfig(config);
    setCurrentStep(4);
  }, []);

  const handleStartProcessing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await processVideo(
        mission.id,
        processingConfig.frameSampling,
        processingConfig.inferenceResolution,
        processingConfig.detectionConfidence,
        processingConfig.reconstructionQuality,
      );
      await generateReconstruction(mission.id);

      onMissionCreated?.(mission.id);
      onClose();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [mission, processingConfig, onMissionCreated, onClose]);

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal create-mission-modal">
        <div className="modal-header">
          <h2>Create New Mission</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-progress">
          <div className="progress-steps">
            {["Setup", "Video", "Config", "Start"].map((label, i) => (
              <div
                key={i + 1}
                className={`progress-step ${
                  currentStep === i + 1
                    ? "active"
                    : currentStep > i + 1
                      ? "completed"
                      : "pending"
                }`}
              >
                <span>{i + 1}</span>
                <label>{label}</label>
              </div>
            ))}
          </div>
          <div
            className="progress-bar"
            style={{ width: `${(currentStep / 4) * 100}%` }}
          />
        </div>

        <div className="modal-content">
          {error && <div className="error-message">{error}</div>}

          {currentStep === 1 && (
            <MissionSetupForm
              onSubmit={handleStepOneSubmit}
              loading={loading}
            />
          )}

          {currentStep === 2 && mission && (
            <VideoUploadForm
              mission={mission}
              onUpload={handleVideoUpload}
              loading={loading}
            />
          )}

          {currentStep === 3 && videoFile && (
            <ProcessingConfigForm
              videoFile={videoFile}
              onSubmit={handleProcessingConfig}
              loading={loading}
            />
          )}

          {currentStep === 4 && (
            <div className="step-content">
              <div className="step-header">
                <span className="step-kicker">STEP 4</span>
                <h3>Start Single-Pass Processing</h3>
                <p>Ready to begin analysis. Click below to start.</p>
              </div>

              <div className="processing-preview">
                <div className="preview-item">
                  <strong>Mission:</strong> {mission.name}
                </div>
                <div className="preview-item">
                  <strong>Location:</strong>{" "}
                  {mission.location || "Not specified"}
                </div>
                <div className="preview-item">
                  <strong>Video:</strong> {videoFile.name}
                </div>
                <div className="preview-item">
                  <strong>Frame Sampling:</strong>{" "}
                  {processingConfig.frameSampling} fps
                </div>
                <div className="preview-item">
                  <strong>Detection Confidence:</strong>{" "}
                  {(processingConfig.detectionConfidence * 100).toFixed(0)}%
                </div>
              </div>

              <div className="modal-actions">
                <button
                  className="btn secondary"
                  onClick={handleBack}
                  disabled={loading}
                >
                  Back
                </button>
                <button
                  className="btn primary"
                  onClick={handleStartProcessing}
                  disabled={loading}
                >
                  {loading ? "Processing..." : "START PROCESSING"}
                </button>
              </div>
            </div>
          )}
        </div>

        {currentStep > 1 && currentStep < 4 && (
          <div className="modal-actions">
            <button
              className="btn secondary"
              onClick={handleBack}
              disabled={loading}
            >
              Back
            </button>
            <button
              className="btn secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
