import { useState, useRef } from "react";

/**
 * Step 2: Video Upload
 * Upload drone video with drag-drop and preview
 */
export default function VideoUploadForm({ onUpload, loading }) {
  const [file, setFile] = useState(null);
  const [videoInfo, setVideoInfo] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInput = useRef(null);

  const supportedFormats = ["MP4", "MOV", "WEBM", "AVI", "MKV", "M4V"];

  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return;

    const ext = selectedFile.name.split(".").pop().toUpperCase();
    if (!supportedFormats.includes(ext)) {
      alert(
        `Unsupported format: ${ext}. Supported formats: ${supportedFormats.join(", ")}`,
      );
      return;
    }

    setFile(selectedFile);
    setVideoInfo({
      name: selectedFile.name,
      size: (selectedFile.size / (1024 * 1024)).toFixed(2),
      type: ext,
    });
  };

  const handleChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) handleFileSelect(selectedFile);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) handleFileSelect(droppedFile);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!file) {
      alert("Please select a video file");
      return;
    }
    onUpload(file);
  };

  const handleRemove = () => {
    setFile(null);
    setVideoInfo(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <div className="step-content">
      <div className="step-header">
        <span className="step-kicker">STEP 2</span>
        <h3>Video Ingestion</h3>
        <p>Upload your drone flight recording</p>
      </div>

      <form onSubmit={handleSubmit} className="video-upload-form">
        {!file ? (
          <>
            <div
              className={`drag-drop-zone ${dragActive ? "active" : ""}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInput.current?.click()}
            >
              <div className="drag-drop-content">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                >
                  <path
                    d="M12 16V4M7 9l5-5 5 5M20 20H4"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <h4>Drag and drop your video here</h4>
                <p>or click to browse</p>
                <span className="format-info">
                  Supported: MP4, MOV, WebM, AVI, MKV, M4V
                </span>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept=".mp4,.mov,.webm,.avi,.mkv,.m4v"
                onChange={handleChange}
                disabled={loading}
                style={{ display: "none" }}
              />
            </div>
          </>
        ) : (
          <div className="video-preview">
            <div className="preview-info">
              <div className="preview-icon">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                >
                  <path
                    d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 2v6h6"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="13" r="3" fill="currentColor" />
                </svg>
              </div>
              <div className="preview-details">
                <h4>{videoInfo.name}</h4>
                <p>
                  {videoInfo.size} MB • {videoInfo.type}
                </p>
              </div>
              <button
                type="button"
                className="btn-remove"
                onClick={handleRemove}
                disabled={loading}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <button
          type="submit"
          className="btn primary"
          disabled={loading || !file}
        >
          {loading ? "Uploading..." : "Next: Processing Config"}
        </button>
      </form>

      <div className="video-info-section">
        <h4>Video Requirements</h4>
        <ul>
          <li>Minimum: 30 seconds duration</li>
          <li>Recommended: 1-5 minutes</li>
          <li>Resolution: 1080p or higher</li>
          <li>Frame rate: 24-60 fps</li>
        </ul>
      </div>
    </div>
  );
}
