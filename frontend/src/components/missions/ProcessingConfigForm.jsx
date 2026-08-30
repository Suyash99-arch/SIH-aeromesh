import { useState } from "react";

/**
 * Step 3: Processing Configuration
 * Set processing parameters before starting analysis
 */
export default function ProcessingConfigForm({ videoFile, onSubmit, loading }) {
  const [config, setConfig] = useState({
    frameSampling: 2,
    inferenceResolution: 640,
    detectionConfidence: 0.35,
    reconstructionQuality: "medium",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: isNaN(value) ? value : parseFloat(value),
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(config);
  };

  const presets = {
    fast: {
      frameSampling: 1,
      inferenceResolution: 416,
      detectionConfidence: 0.4,
      reconstructionQuality: "low",
    },
    balanced: {
      frameSampling: 2,
      inferenceResolution: 640,
      detectionConfidence: 0.35,
      reconstructionQuality: "medium",
    },
    quality: {
      frameSampling: 4,
      inferenceResolution: 1024,
      detectionConfidence: 0.3,
      reconstructionQuality: "high",
    },
  };

  const applyPreset = (preset) => {
    setConfig(presets[preset]);
  };

  return (
    <div className="step-content">
      <div className="step-header">
        <span className="step-kicker">STEP 3</span>
        <h3>Processing Configuration</h3>
        <p>Tune analysis parameters for your use case</p>
      </div>

      <form onSubmit={handleSubmit} className="processing-config-form">
        <div className="preset-buttons">
          <div className="preset-label">Quick Presets:</div>
          <button
            type="button"
            className="btn-preset"
            onClick={() => applyPreset("fast")}
          >
            ⚡ Fast
          </button>
          <button
            type="button"
            className="btn-preset"
            onClick={() => applyPreset("balanced")}
          >
            ⚙ Balanced
          </button>
          <button
            type="button"
            className="btn-preset"
            onClick={() => applyPreset("quality")}
          >
            ✓ Quality
          </button>
        </div>

        <div className="config-group">
          <div className="form-group">
            <label htmlFor="frameSampling">
              Frame Sampling
              <span className="hint">
                {config.frameSampling} fps (lower = faster, higher = more
                frames)
              </span>
            </label>
            <input
              id="frameSampling"
              type="range"
              name="frameSampling"
              min="1"
              max="10"
              step="1"
              value={config.frameSampling}
              onChange={handleChange}
              disabled={loading}
            />
            <div className="range-labels">
              <span>Fast (1 fps)</span>
              <span>Balanced (2 fps)</span>
              <span>Quality (10 fps)</span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="inferenceResolution">
              Inference Resolution
              <span className="hint">
                {config.inferenceResolution}p (higher = better detection,
                slower)
              </span>
            </label>
            <select
              id="inferenceResolution"
              name="inferenceResolution"
              value={config.inferenceResolution}
              onChange={handleChange}
              disabled={loading}
            >
              <option value={416}>416p - Fast</option>
              <option value={640}>640p - Balanced</option>
              <option value={1024}>1024p - Quality</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="detectionConfidence">
              Detection Confidence Threshold
              <span className="hint">
                {(config.detectionConfidence * 100).toFixed(0)}% (higher = fewer
                false positives)
              </span>
            </label>
            <input
              id="detectionConfidence"
              type="range"
              name="detectionConfidence"
              min="0.10"
              max="0.95"
              step="0.05"
              value={config.detectionConfidence}
              onChange={handleChange}
              disabled={loading}
            />
            <div className="range-labels">
              <span>Sensitive (10%)</span>
              <span>Balanced (35%)</span>
              <span>Strict (95%)</span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="reconstructionQuality">
              Reconstruction Quality
              <span className="hint">{config.reconstructionQuality}</span>
            </label>
            <select
              id="reconstructionQuality"
              name="reconstructionQuality"
              value={config.reconstructionQuality}
              onChange={handleChange}
              disabled={loading}
            >
              <option value="low">Low - Faster processing</option>
              <option value="medium">Medium - Balanced</option>
              <option value="high">High - Best quality</option>
            </select>
          </div>
        </div>

        <div className="config-info">
          <div className="info-item">
            <strong>Video:</strong> {videoFile.name}
          </div>
          <div className="info-item">
            <strong>Estimated Processing Time:</strong>
            {config.frameSampling <= 2
              ? "5-10 minutes"
              : config.frameSampling <= 4
                ? "10-20 minutes"
                : "20-30 minutes"}
          </div>
          <div className="info-item">
            <strong>GPU Recommended:</strong>
            {config.inferenceResolution >= 1024 ? "Yes" : "Optional"}
          </div>
        </div>

        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? "Configuring..." : "Next: Start Processing"}
        </button>
      </form>
    </div>
  );
}
