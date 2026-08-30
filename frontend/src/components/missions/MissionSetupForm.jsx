import { useState } from "react";

/**
 * Step 1: Mission Setup
 * Collect basic mission information
 */
export default function MissionSetupForm({ onSubmit, loading }) {
  const [formData, setFormData] = useState({
    name: "",
    missionType: "single-pass",
    location: "",
    operator: "",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert("Mission name is required");
      return;
    }
    onSubmit(formData);
  };

  return (
    <div className="step-content">
      <div className="step-header">
        <span className="step-kicker">STEP 1</span>
        <h3>Mission Setup</h3>
        <p>Define your mission parameters</p>
      </div>

      <form onSubmit={handleSubmit} className="mission-form">
        <div className="form-group">
          <label htmlFor="name">Mission Name *</label>
          <input
            id="name"
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="e.g., Disaster Response - Sector 04"
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="type">Mission Type *</label>
          <select
            id="type"
            name="missionType"
            value={formData.missionType}
            onChange={handleChange}
            disabled={loading}
          >
            <option value="single-pass">
              Single-Pass Aerial Reconstruction
            </option>
            <option value="emergency">Emergency Response</option>
            <option value="infrastructure">Infrastructure Inspection</option>
            <option value="survey">Urban Survey</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="location">Location</label>
          <input
            id="location"
            type="text"
            name="location"
            value={formData.location}
            onChange={handleChange}
            placeholder="e.g., Downtown District, City, Country"
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="operator">Operator / Team</label>
          <input
            id="operator"
            type="text"
            name="operator"
            value={formData.operator}
            onChange={handleChange}
            placeholder="Your name or team identifier"
            disabled={loading}
          />
        </div>

        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? "Creating..." : "Next: Video Upload"}
        </button>
      </form>
    </div>
  );
}
