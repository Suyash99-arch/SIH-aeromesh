import React, { Component } from "react";
import Icon from "../ui/Icon";

/**
 * Robust Error Boundary to isolate component/render crashes.
 * Prevents single-component data anomalies from taking down an entire page or app.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error(
      `[ErrorBoundary] Caught error in ${this.props.sectionName || "Component"}:`,
      error,
      errorInfo,
    );
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === "function"
          ? this.props.fallback({
              error: this.state.error,
              reset: this.handleReset,
            })
          : this.props.fallback;
      }

      const isTopLevel =
        this.props.level === "top" ||
        this.props.sectionName === "Application Shell";
      const title =
        this.props.title || "Something went wrong displaying this section";
      const section = this.props.sectionName || "Section";

      return (
        <div
          className={`error-boundary-container ${
            isTopLevel ? "error-boundary--toplevel" : "error-boundary--section"
          }`}
          role="alert"
          style={{
            padding: isTopLevel ? "48px 24px" : "28px 24px",
            margin: isTopLevel ? "0" : "12px 0",
            minHeight: isTopLevel ? "100vh" : "180px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            background: "rgba(15, 23, 42, 0.92)",
            border: "1px solid rgba(239, 68, 68, 0.35)",
            borderRadius: "12px",
            backdropFilter: "blur(12px)",
            color: "#f8fafc",
            boxShadow: "0 12px 36px rgba(0, 0, 0, 0.4)",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "46px",
              height: "46px",
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "14px",
              color: "#f87171",
            }}
          >
            <Icon name="AlertTriangle" size={24} />
          </div>

          <span
            style={{
              fontSize: "11px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: "#f87171",
              background: "rgba(239, 68, 68, 0.12)",
              padding: "3px 10px",
              borderRadius: "999px",
              marginBottom: "10px",
              border: "1px solid rgba(239, 68, 68, 0.25)",
            }}
          >
            {section}
          </span>

          <h3
            style={{
              fontSize: isTopLevel ? "20px" : "16px",
              fontWeight: 700,
              color: "#ffffff",
              margin: "0 0 8px 0",
            }}
          >
            {title}
          </h3>

          <p
            style={{
              fontSize: "13px",
              color: "rgba(203, 213, 225, 0.9)",
              maxWidth: "520px",
              lineHeight: 1.5,
              margin: "0 0 20px 0",
            }}
          >
            {this.props.message ||
              "An unexpected error occurred while rendering this component. Other areas of the platform remain fully functional."}
          </p>

          <div
            style={{
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                background: "linear-gradient(135deg, #0284c7, #0369a1)",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                padding: "8px 18px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                boxShadow: "0 2px 8px rgba(2, 132, 199, 0.3)",
              }}
            >
              <Icon name="RefreshCw" size={14} /> Retry Section
            </button>
            {isTopLevel && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "#e2e8f0",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "8px",
                  padding: "8px 18px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reload Entire Application
              </button>
            )}
          </div>

          {this.state.error && (
            <details
              style={{
                marginTop: "18px",
                maxWidth: "640px",
                width: "100%",
                textAlign: "left",
                background: "rgba(0, 0, 0, 0.4)",
                borderRadius: "6px",
                padding: "8px 12px",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: "11.5px",
                  color: "#94a3b8",
                  userSelect: "none",
                }}
              >
                Diagnostic Details
              </summary>
              <pre
                style={{
                  marginTop: "8px",
                  fontSize: "11px",
                  color: "#fca5a5",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  maxHeight: "160px",
                  overflowY: "auto",
                  fontFamily: "monospace",
                }}
              >
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
