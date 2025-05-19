/**
 * New Restaurant Page - Allows creation of a new restaurant entry with transcription and additional review recording.
 * Dependencies: React, RecordingButton
 */
import React, { useEffect } from 'react';
import RecordingButton from '../components/RecordingButton';

const NewRestaurantPage = () => {
  useEffect(() => {
    // Ensure any DOM-based modules (like conceptModule) can attach the additional review UI
    if (window.uiManager && window.uiManager.conceptModule && typeof window.uiManager.conceptModule.setupAdditionalReviewButton === 'function') {
      window.uiManager.conceptModule.setupAdditionalReviewButton();
    }
  }, []);

  return (
    <div className="new-restaurant-page">
      {/* ...existing code... */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Transcription:</h2>
        {/* Main recording and additional review */}
        <RecordingButton enableAdditional={true} />
        {/* The transcription textarea must have id="restaurant-transcription" for additional review to work */}
        <textarea
          id="restaurant-transcription"
          className="w-full border rounded p-3 mt-3"
          rows={6}
          placeholder="Your transcription will appear here..."
        />
        {/* The additional review UI will be injected below by conceptModule */}
      </section>
      {/* ...existing code... */}
    </div>
  );
};

export default NewRestaurantPage;