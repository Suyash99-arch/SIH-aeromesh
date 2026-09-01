import { useState, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Icon from "../components/ui/Icon";
import { Button } from "../components/ui/UI";
import { getMission as getApiMission } from "../api/missions";
import { missions as seedMissions } from "../data/missions";
import "../styles/homepage.css";

const Navigation = ({ onNavigateDashboard, onStartMission }) => {
  const reduceMotion = useReducedMotion();

  return (
    <nav className="homepage-nav">
      <div className="nav-brand">
        <div className="logo-icon">
          <Icon name="Zap" size={24} />
        </div>
        <div className="logo-text">
          <strong>AeroMesh</strong>
        </div>
      </div>

      <div className="nav-menu">
        <a href="#hero">Home</a>
        <a href="#capabilities">Missions</a>
        <a href="#stats">Analysis</a>
        <a href="#how-it-works">3D Viewer</a>
        <a href="#recent">Reports</a>
        <a href="#cta">About</a>
      </div>

      <div className="nav-actions">
        <Button
          variant="secondary"
          onClick={onNavigateDashboard}
          className="nav-login"
        >
          Dashboard
        </Button>
      </div>
    </nav>
  );
};

const HeroSection = ({ onStartMission }) => {
  const reduceMotion = useReducedMotion();

  return (
    <section className="homepage-hero" id="hero">
      <div className="hero-content">
        <motion.div
          className="hero-text"
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="hero-badge">
            <Icon name="Zap" size={14} />
            AI-Powered UAV Inspection
          </span>

          <h1>AI-Powered UAV Damage Detection & 3D Reconstruction</h1>

          <p>
            Convert drone inspection imagery into actionable intelligence.
            AeroMesh performs real-time damage detection, 3D reconstruction, and
            confidence analysis—all in a single flight.
          </p>

          <div className="hero-buttons">
            <Button
              variant="primary"
              onClick={onStartMission}
              icon="Play"
              className="hero-btn"
            >
              Start New Mission
            </Button>
            <Button variant="secondary" icon="BookOpen" className="hero-btn">
              View Missions
            </Button>
          </div>

          <div className="hero-metrics">
            <div className="metric">
              <strong>120+</strong>
              <span>Missions Completed</span>
            </div>
            <div className="metric">
              <strong>98.7%</strong>
              <span>Detection Accuracy</span>
            </div>
            <div className="metric">
              <strong>5 min</strong>
              <span>Avg Processing</span>
            </div>
          </div>
        </motion.div>

        <motion.div
          className="hero-visual"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="drone-visual">
            <svg viewBox="0 0 200 200" className="drone-icon">
              <defs>
                <linearGradient
                  id="droneGradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#00d9ff" />
                  <stop offset="100%" stopColor="#0ea5e9" />
                </linearGradient>
                <filter id="droneGlow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Drone body */}
              <circle
                cx="100"
                cy="100"
                r="20"
                fill="url(#droneGradient)"
                filter="url(#droneGlow)"
              />

              {/* Drone arms */}
              <line
                x1="80"
                y1="100"
                x2="30"
                y2="100"
                stroke="url(#droneGradient)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <line
                x1="120"
                y1="100"
                x2="170"
                y2="100"
                stroke="url(#droneGradient)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <line
                x1="100"
                y1="80"
                x2="100"
                y2="30"
                stroke="url(#droneGradient)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <line
                x1="100"
                y1="120"
                x2="100"
                y2="170"
                stroke="url(#droneGradient)"
                strokeWidth="3"
                strokeLinecap="round"
              />

              {/* Propellers */}
              <circle
                cx="30"
                cy="100"
                r="12"
                fill="none"
                stroke="url(#droneGradient)"
                strokeWidth="2"
                opacity="0.7"
              />
              <circle
                cx="170"
                cy="100"
                r="12"
                fill="none"
                stroke="url(#droneGradient)"
                strokeWidth="2"
                opacity="0.7"
              />
              <circle
                cx="100"
                cy="30"
                r="12"
                fill="none"
                stroke="url(#droneGradient)"
                strokeWidth="2"
                opacity="0.7"
              />
              <circle
                cx="100"
                cy="170"
                r="12"
                fill="none"
                stroke="url(#droneGradient)"
                strokeWidth="2"
                opacity="0.7"
              />

              {/* Center camera */}
              <rect
                x="95"
                y="95"
                width="10"
                height="10"
                rx="2"
                fill="url(#droneGradient)"
              />
            </svg>

            {/* Animated scan lines */}
            <div className="scan-circle scan-1"></div>
            <div className="scan-circle scan-2"></div>
            <div className="scan-circle scan-3"></div>
          </div>

          <div className="hero-details">
            <div className="detail-item">
              <Icon name="Video" size={18} />
              <span>Single-pass video</span>
            </div>
            <div className="detail-item">
              <Icon name="Zap" size={18} />
              <span>AI damage detection</span>
            </div>
            <div className="detail-item">
              <Icon name="Box" size={18} />
              <span>3D reconstruction</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

const CapabilitiesSection = () => {
  const reduceMotion = useReducedMotion();
  const capabilities = [
    {
      icon: "Zap",
      title: "AI Damage Detection",
      description:
        "Real-time detection of structural damage using advanced YOLO neural networks.",
    },
    {
      icon: "Box",
      title: "3D Reconstruction",
      description:
        "Single-pass drone video converted to high-fidelity 3D models and point clouds.",
    },
    {
      icon: "Gauge",
      title: "Fast & Accurate",
      description:
        "Process mission data in minutes with 98%+ detection confidence.",
    },
    {
      icon: "Briefcase",
      title: "Mission Management",
      description:
        "Organize, track, and generate comprehensive inspection reports.",
    },
  ];

  return (
    <section className="homepage-capabilities" id="capabilities">
      <div className="section-header">
        <h2>Core Capabilities</h2>
        <p>Everything you need for professional aerial inspection</p>
      </div>

      <div className="capabilities-grid">
        {capabilities.map((cap, i) => (
          <motion.div
            key={cap.title}
            className="capability-card"
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.5,
              delay: i * 0.1,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="cap-icon">
              <Icon name={cap.icon} size={28} />
            </div>
            <h3>{cap.title}</h3>
            <p>{cap.description}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
};

const StatsSection = ({ stats }) => {
  const reduceMotion = useReducedMotion();

  return (
    <section className="homepage-stats" id="stats">
      <div className="stats-container">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            className="stat-item"
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.5,
              delay: i * 0.08,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="stat-value">{stat.value}</div>
            <div className="stat-label">{stat.label}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
};

const HowItWorksSection = () => {
  const reduceMotion = useReducedMotion();
  const steps = [
    {
      number: "01",
      title: "Capture",
      description: "Upload drone video or connect live UAV feed",
      icon: "Video",
    },
    {
      number: "02",
      title: "AI Analysis",
      description: "Real-time damage detection and classification",
      icon: "Zap",
    },
    {
      number: "03",
      title: "3D Reconstruction",
      description: "Generate high-fidelity 3D models from frames",
      icon: "Box",
    },
    {
      number: "04",
      title: "Review & Report",
      description: "Export comprehensive inspection reports",
      icon: "FileText",
    },
  ];

  return (
    <section className="homepage-how-it-works" id="how-it-works">
      <div className="section-header">
        <h2>How AeroMesh Works</h2>
        <p>Four simple steps from drone to decision</p>
      </div>

      <div className="steps-container">
        {steps.map((step, i) => (
          <motion.div
            key={step.number}
            className="step-item"
            initial={reduceMotion ? false : { opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.5,
              delay: i * 0.1,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="step-number">{step.number}</div>
            <div className="step-content">
              <div className="step-icon">
                <Icon name={step.icon} size={24} />
              </div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>

            {i < steps.length - 1 && (
              <div className="step-arrow">
                <Icon name="ArrowRight" size={20} />
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </section>
  );
};

const RecentMissionsSection = ({ missions }) => {
  const reduceMotion = useReducedMotion();

  if (!missions || missions.length === 0) {
    return null;
  }

  return (
    <section className="homepage-recent-missions" id="recent">
      <div className="section-header">
        <h2>Recent Missions</h2>
        <p>Latest aerial inspections</p>
      </div>

      <div className="missions-table">
        <div className="missions-header">
          <div className="col-id">Mission ID</div>
          <div className="col-type">UAV Type</div>
          <div className="col-status">Status</div>
          <div className="col-date">Date</div>
          <div className="col-action">Action</div>
        </div>

        {missions.map((mission, i) => (
          <motion.div
            key={mission.id}
            className="missions-row"
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.4,
              delay: i * 0.05,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="col-id">{mission.id}</div>
            <div className="col-type">{mission.drone || "Unknown"}</div>
            <div className="col-status">
              <span className={`status-badge status-${mission.status}`}>
                {mission.status || "Ready"}
              </span>
            </div>
            <div className="col-date">
              {new Date(mission.createdAt || Date.now()).toLocaleDateString()}
            </div>
            <div className="col-action">
              <button className="view-btn">
                View
                <Icon name="ArrowRight" size={14} />
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
};

const CTASection = ({ onStartMission }) => {
  const reduceMotion = useReducedMotion();

  return (
    <section className="homepage-cta" id="cta">
      <motion.div
        className="cta-content"
        initial={reduceMotion ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <h2>Turn Drone Data Into Actionable Intelligence</h2>
        <p>
          Join 120+ teams using AeroMesh for professional aerial inspections.
          Start your first mission today.
        </p>
        <Button
          variant="primary"
          onClick={onStartMission}
          icon="Play"
          className="cta-btn"
        >
          Start New Mission
        </Button>
      </motion.div>
    </section>
  );
};

export default function HomePage({ onNavigateDashboard, onStartMission }) {
  const [recentMissions, setRecentMissions] = useState([]);
  const [stats, setStats] = useState([
    { label: "Missions Completed", value: "120+" },
    { label: "Detection Accuracy", value: "98.7%" },
    { label: "Avg Processing", value: "5 min" },
    { label: "System Uptime", value: "24/7" },
  ]);

  useEffect(() => {
    // Load recent missions from seeded data
    const recent = seedMissions.slice(0, 6).map((m) => ({
      id: m.id,
      drone: m.drone,
      status: m.status,
      createdAt: m.createdAt || new Date().toISOString(),
    }));
    setRecentMissions(recent);

    // Try to fetch real stats from first mission
    if (seedMissions.length > 0) {
      getApiMission(seedMissions[0].id).then((mission) => {
        if (mission && !mission.hasError) {
          setStats([
            { label: "Missions Completed", value: "120+" },
            {
              label: "Detection Accuracy",
              value: `${mission.confidence || 98}%`,
            },
            { label: "Avg Processing", value: mission.duration || "5 min" },
            { label: "System Uptime", value: "24/7" },
          ]);
        }
      });
    }
  }, []);

  return (
    <div className="homepage">
      <Navigation
        onNavigateDashboard={onNavigateDashboard}
        onStartMission={onStartMission}
      />

      <main className="homepage-main">
        <HeroSection onStartMission={onStartMission} />
        <CapabilitiesSection />
        <StatsSection stats={stats} />
        <HowItWorksSection />
        <RecentMissionsSection missions={recentMissions} />
        <CTASection onStartMission={onStartMission} />
      </main>

      <footer className="homepage-footer">
        <div className="footer-content">
          <div className="footer-section">
            <strong>AeroMesh</strong>
            <p>AI-powered UAV damage detection & 3D reconstruction</p>
          </div>
          <div className="footer-section">
            <h4>Product</h4>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#docs">Documentation</a>
          </div>
          <div className="footer-section">
            <h4>Company</h4>
            <a href="#about">About</a>
            <a href="#blog">Blog</a>
            <a href="#contact">Contact</a>
          </div>
          <div className="footer-section">
            <h4>Legal</h4>
            <a href="#privacy">Privacy</a>
            <a href="#terms">Terms</a>
            <a href="#security">Security</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2025 AeroMesh. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
