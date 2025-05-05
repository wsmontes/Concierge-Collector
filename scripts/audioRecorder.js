/**
 * Audio recording functionality with MP3 conversion
 */
class AudioRecorder {
    constructor(maxDurationSec = 300) { // 300 seconds = 5 minutes
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.audioBlob = null;
        this.audioUrl = null;
        this.startTime = null;
        this.timerInterval = null;
        this.maxDuration = maxDurationSec * 1000; // Convert to milliseconds
        this.timerDisplay = document.getElementById('timer');
    }

    async requestPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            return stream;
        } catch (err) {
            console.error('Error accessing microphone:', err);
            throw new Error('Microphone access denied. Please allow microphone access to record.');
        }
    }

    startRecording() {
        return new Promise(async (resolve, reject) => {
            try {
                // Release previous MediaRecorder if exists
                if (this.mediaRecorder) {
                    if (this.mediaRecorder.state === 'recording') {
                        await this.stopRecording();
                    }
                    this.mediaRecorder = null;
                }
                
                const stream = await this.requestPermission();
                this.audioChunks = [];
                
                // Create MediaRecorder with opus codec for better quality
                this.mediaRecorder = new MediaRecorder(stream, {
                    mimeType: 'audio/webm;codecs=opus'
                });

                this.mediaRecorder.addEventListener('dataavailable', event => {
                    this.audioChunks.push(event.data);
                });

                this.mediaRecorder.addEventListener('stop', async () => {
                    this.audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    this.audioUrl = URL.createObjectURL(this.audioBlob);
                    
                    // Stop all tracks to release microphone
                    stream.getTracks().forEach(track => track.stop());
                    
                    // Convert to MP3 and resolve with audio data
                    try {
                        const mp3Blob = await this.convertToMp3(this.audioBlob);
                        resolve({
                            webmBlob: this.audioBlob,
                            webmUrl: this.audioUrl,
                            mp3Blob: mp3Blob,
                            mp3Url: URL.createObjectURL(mp3Blob),
                            duration: this.startTime ? Date.now() - this.startTime : 0
                        });
                    } catch (err) {
                        reject(err);
                    }
                });

                // Start recording
                this.mediaRecorder.start(1000); // Capture in 1-second chunks
                this.startTimer();
                
                // Auto-stop after max duration
                setTimeout(() => {
                    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                        this.stopRecording();
                    }
                }, this.maxDuration);
                
                resolve(true);
            } catch (err) {
                reject(err);
            }
        });
    }

    stopRecording() {
        return new Promise((resolve, reject) => {
            if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
                reject(new Error('Not recording'));
                return;
            }
            
            this.stopTimer();
            
            // Create a one-time event handler that will resolve the promise
            // after the MediaRecorder's 'stop' event completes
            const stopHandler = async () => {
                try {
                    this.mediaRecorder.removeEventListener('stop', stopHandler);
                    
                    this.audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    this.audioUrl = URL.createObjectURL(this.audioBlob);
                    
                    // Convert to MP3 for better compatibility
                    const mp3Blob = await this.convertToMp3(this.audioBlob);
                    this.mp3Blob = mp3Blob;
                    this.mp3Url = URL.createObjectURL(mp3Blob);
                    
                    resolve({
                        webmBlob: this.audioBlob,
                        webmUrl: this.audioUrl,
                        mp3Blob: mp3Blob,
                        mp3Url: this.mp3Url,
                        duration: this.startTime ? Date.now() - this.startTime : 0
                    });
                } catch (err) {
                    reject(err);
                }
            };
            
            this.mediaRecorder.addEventListener('stop', stopHandler);
            this.mediaRecorder.stop();
        });
    }

    startTimer() {
        this.startTime = Date.now();
        this.updateTimerDisplay();
        
        this.timerInterval = setInterval(() => {
            this.updateTimerDisplay();
            
            // Auto-stop if max duration is reached
            const elapsed = Date.now() - this.startTime;
            if (elapsed >= this.maxDuration) {
                this.stopRecording();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateTimerDisplay() {
        if (!this.startTime) return;
        
        const elapsed = Date.now() - this.startTime;
        const seconds = Math.floor((elapsed / 1000) % 60);
        const minutes = Math.floor((elapsed / (1000 * 60)) % 60);
        
        this.timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // Visual warning when approaching max duration
        if (elapsed > this.maxDuration * 0.8) {
            this.timerDisplay.classList.add('text-red-500');
        } else {
            this.timerDisplay.classList.remove('text-red-500');
        }
    }

    async convertToMp3(webmBlob) {
        return new Promise((resolve, reject) => {
            // Convert Blob to ArrayBuffer
            const fileReader = new FileReader();
            fileReader.onload = async function(event) {
                try {
                    const arrayBuffer = event.target.result;
                    
                    // Use Web Audio API to decode the audio
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    
                    // Convert to MP3 using lamejs
                    const mp3Encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128);
                    const samples = new Int16Array(audioBuffer.length);
                    
                    // Get audio samples from the first channel
                    const channelData = audioBuffer.getChannelData(0);
                    for (let i = 0; i < channelData.length; i++) {
                        // Convert Float32 to Int16
                        samples[i] = channelData[i] < 0 
                            ? channelData[i] * 0x8000 
                            : channelData[i] * 0x7FFF;
                    }
                    
                    // Encode to MP3
                    const mp3Data = [];
                    const sampleBlockSize = 1152; // MPEG-1 Layer 3 block size
                    
                    for (let i = 0; i < samples.length; i += sampleBlockSize) {
                        const sampleChunk = samples.subarray(i, i + sampleBlockSize);
                        const mp3buf = mp3Encoder.encodeBuffer(sampleChunk);
                        if (mp3buf.length > 0) {
                            mp3Data.push(mp3buf);
                        }
                    }
                    
                    // Get final part and concatenate
                    const mp3buf = mp3Encoder.flush();
                    if (mp3buf.length > 0) {
                        mp3Data.push(mp3buf);
                    }
                    
                    // Combine chunks into a single Uint8Array
                    let totalLength = 0;
                    for (let i = 0; i < mp3Data.length; i++) {
                        totalLength += mp3Data[i].length;
                    }
                    
                    const mp3Buffer = new Uint8Array(totalLength);
                    let offset = 0;
                    for (let i = 0; i < mp3Data.length; i++) {
                        mp3Buffer.set(mp3Data[i], offset);
                        offset += mp3Data[i].length;
                    }
                    
                    // Create MP3 Blob
                    const mp3Blob = new Blob([mp3Buffer], { type: 'audio/mp3' });
                    resolve(mp3Blob);
                } catch (err) {
                    console.error('MP3 conversion error:', err);
                    reject(err);
                }
            };
            
            fileReader.onerror = function(error) {
                reject(error);
            };
            
            fileReader.readAsArrayBuffer(webmBlob);
        });
    }
}

// Create a global instance
const audioRecorder = new AudioRecorder();
