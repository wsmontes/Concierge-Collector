/**
 * Main Application View - Renders the main interface including recording functionality
 * Dependencies: React, RecordingButton, other components
 */
import React, { useState } from 'react';
import RecordingButton from '../components/RecordingButton';

const MainView = () => {
  const [isEditMode, setIsEditMode] = useState(false);

  return (
    <div className="main-container">
      {/* Toggle for edit mode */}
      <div className="edit-mode-toggle">
        <label>
          <input
            type="checkbox"
            checked={isEditMode}
            onChange={() => setIsEditMode(!isEditMode)}
          />
          Edit Mode
        </label>
      </div>

      {/* Pass the current mode to the RecordingButton */}
      <RecordingButton isEditMode={isEditMode} />
    </div>
  );
};

export default MainView;