import React from "react";
import NewIncidentWorkspace from "./NewIncidentWorkspace";

/**
 * Replaced with the disaster-response NewIncidentWorkspace
 * matching reference screenshot 3 (offline-safe incident details,
 * side-by-side drag-and-drop video upload + preview, and right-rail summary).
 */
export default function CreateMissionModal({ onClose, onMissionCreated, currentUser, notice }) {
  return (
    <NewIncidentWorkspace
      onClose={onClose}
      onMissionCreated={onMissionCreated}
      currentUser={currentUser}
      notice={notice}
    />
  );
}
