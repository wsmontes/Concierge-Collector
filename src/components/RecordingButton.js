/**
 * Recording Button Component - Handles both standard and edit mode recording functionality,
 * including additional recording for appending reviews.
 * Dependencies: React, recordingService
 */
import React, { useState, useEffect, useRef } from 'react';
import { recordingService } from '../services/recordingService';

const RecordingButton = ({ isEditMode = false, enableAdditional = false }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [timerInterval, setTimerInterval] = useState(null);
  const [isAdditional, setIsAdditional] = useState(false);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerInterval) clearInterval(timerInterval);
    };
  }, [timerInterval]);

  const startRecording = async (additional = false) => {
    try {
      if (isRecording || isProcessingRef.current) {
        console.log("Recording already in progress or operation in process");
        return;
      }
      isProcessingRef.current = true;
      setIsRecording(true);
      setRecordingTime(0);
      setIsAdditional(additional);

      const interval = setInterval(() => {
        setRecordingTime(prevTime => prevTime + 1);
      }, 1000);
      setTimerInterval(interval);

      if (window.recordingModule && window.recordingModule.uiManager) {
        window.recordingModule.uiManager.isEditMode = isEditMode;
        window.recordingModule.uiManager.isRecordingAdditional = additional;
      }
      if (additional) {
        await recordingService.startEditModeRecording();
      } else if (isEditMode) {
        await recordingService.startEditModeRecording();
      } else {
        await recordingService.startRecording();
      }
      isProcessingRef.current = false;
    } catch (error) {
      console.error("Error starting recording:", error);
      setIsRecording(false);
      if (timerInterval) {
        clearInterval(timerInterval);
        setTimerInterval(null);
      }
      isProcessingRef.current = false;
    }
  };

  const stopRecording = async () => {
    try {
      if (!isRecording || isProcessingRef.current) {
        console.log("No active recording to stop or operation in process");
        return;
      }
      isProcessingRef.current = true;
      setIsRecording(false);
      const currentInterval = timerInterval;
      if (currentInterval) {
        clearInterval(currentInterval);
        setTimerInterval(null);
      }
      setTimeout(async () => {
        try {
          if (isAdditional || isEditMode) {
            await recordingService.stopEditModeRecording();
          } else {
            await recordingService.stopRecording();
          }
        } catch (err) {
          console.error("Recording stop failed:", err);
        } finally {
          isProcessingRef.current = false;
          setIsAdditional(false);
        }
      }, 100);
    } catch (error) {
      console.error("Error stopping recording:", error);
      isProcessingRef.current = false;
      setIsAdditional(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className={`recording-container ${isEditMode ? 'edit-mode' : ''}`}>
      {/* Main Recording Button */}
      {!isRecording && (
        <button
          className={`start-recording-button ${isEditMode ? 'edit-mode' : ''}`}
          onClick={() => startRecording(false)}
          disabled={isProcessingRef.current}
          data-testid="start-recording-button"
        >
          Start Recording
        </button>
      )}
      {/* Additional Recording Button (for new restaurant page if enabled) */}
      {enableAdditional && !isRecording && (
        <button
          className="start-recording-button additional-record"
          onClick={() => startRecording(true)}
          disabled={isProcessingRef.current}
          style={{ marginLeft: 8 }}
          data-testid="start-additional-recording-button"
        >
          Add Additional Review
        </button>
      )}
      {/* Stop Button and Counter */}
      {isRecording && (
        <>
          <button
            className={`stop-recording-button ${isEditMode || isAdditional ? 'edit-mode' : ''}`}
            onClick={stopRecording}
            disabled={isProcessingRef.current}
            data-testid="stop-recording-button"
          >
            Stop Recording
          </button>
          <div
            className={
              isEditMode || isAdditional
                ? "recording-counter edit-mode-counter-small"
                : "recording-counter rounded-counter"
            }
            style={
              isEditMode || isAdditional
                ? { fontSize: "0.85em", padding: "2px 10px", minWidth: 48, textAlign: "center" }
                : {}
            }
          >
            {formatTime(recordingTime)}
          </div>
        </>
      )}
    </div>
  );
};

export default RecordingButton;
