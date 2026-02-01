/**
 * Browser API Mocks
 * Purpose: Mock browser APIs for testing (MediaRecorder, getUserMedia, etc.)
 */

import { vi } from 'vitest';

/**
 * Create mock MediaRecorder
 */
export function createMockMediaRecorder() {
  const mockMediaRecorder = {
    state: 'inactive',
    ondataavailable: null,
    onerror: null,
    onstop: null,
    
    start: vi.fn(function(timeslice) {
      this.state = 'recording';
      // Simulate data available events
      setTimeout(() => {
        if (this.ondataavailable) {
          this.ondataavailable({
            data: new Blob(['test audio data'], { type: 'audio/webm' })
          });
        }
      }, 100);
    }),
    
    stop: vi.fn(function() {
      this.state = 'inactive';
      if (this.onstop) {
        this.onstop();
      }
    }),
    
    pause: vi.fn(function() {
      this.state = 'paused';
    }),
    
    resume: vi.fn(function() {
      this.state = 'recording';
    })
  };
  
  return mockMediaRecorder;
}

/**
 * Setup MediaRecorder mock
 */
export function setupMediaRecorderMock() {
  global.MediaRecorder = vi.fn(function(stream, options) {
    const recorder = createMockMediaRecorder();
    return recorder;
  });
  
  global.MediaRecorder.isTypeSupported = vi.fn((mimeType) => {
    // Support common formats
    return ['audio/webm', 'audio/mp4', 'audio/wav'].some(type => 
      mimeType.includes(type)
    );
  });
}

/**
 * Create mock MediaStream
 */
export function createMockMediaStream() {
  const mockTrack = {
    kind: 'audio',
    id: 'mock-track-id',
    label: 'Mock Audio Track',
    enabled: true,
    muted: false,
    readyState: 'live',
    stop: vi.fn()
  };
  
  const mockStream = {
    id: 'mock-stream-id',
    active: true,
    
    getTracks: vi.fn(() => [mockTrack]),
    getAudioTracks: vi.fn(() => [mockTrack]),
    getVideoTracks: vi.fn(() => []),
    
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    
    clone: vi.fn(function() {
      return createMockMediaStream();
    })
  };
  
  return mockStream;
}

/**
 * Setup getUserMedia mock
 */
export function setupGetUserMediaMock(shouldSucceed = true) {
  global.navigator = global.navigator || {};
  global.navigator.mediaDevices = global.navigator.mediaDevices || {};
  
  if (shouldSucceed) {
    global.navigator.mediaDevices.getUserMedia = vi.fn(async (constraints) => {
      return createMockMediaStream();
    });
  } else {
    global.navigator.mediaDevices.getUserMedia = vi.fn(async () => {
      throw new Error('Permission denied');
    });
  }
}

/**
 * Setup AudioContext mock
 */
export function setupAudioContextMock() {
  const mockAudioBuffer = {
    duration: 5.0,
    length: 220500,
    numberOfChannels: 1,
    sampleRate: 44100,
    getChannelData: vi.fn(() => new Float32Array(220500))
  };
  
  const mockAudioContext = {
    state: 'running',
    sampleRate: 44100,
    
    decodeAudioData: vi.fn(async () => mockAudioBuffer),
    
    createMediaStreamSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn()
    })),
    
    createMediaStreamDestination: vi.fn(() => ({
      stream: createMockMediaStream(),
      connect: vi.fn(),
      disconnect: vi.fn()
    })),
    
    close: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    suspend: vi.fn(async () => {})
  };
  
  global.AudioContext = vi.fn(() => mockAudioContext);
  global.webkitAudioContext = global.AudioContext;
}

/**
 * Setup all browser mocks
 */
export function setupBrowserMocks() {
  setupMediaRecorderMock();
  setupGetUserMediaMock(true);
  setupAudioContextMock();
}

/**
 * Cleanup all browser mocks
 */
export function cleanupBrowserMocks() {
  delete global.MediaRecorder;
  delete global.AudioContext;
  delete global.webkitAudioContext;
  if (global.navigator?.mediaDevices) {
    delete global.navigator.mediaDevices.getUserMedia;
  }
}
