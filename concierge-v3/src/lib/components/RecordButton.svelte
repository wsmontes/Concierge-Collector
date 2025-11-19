<!--
  RecordButton Component
  Purpose: Circular recording button with audio capture functionality
  Dependencies: Web Audio API, design system
  
  Usage:
    <RecordButton onrecordingcomplete={handleAudio} />
  
  Features:
    - Circular 72x72px button (amber gradient)
    - Pulsing animation when recording
    - Timer display
    - Waveform visualization
    - Audio capture and blob export
-->
<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		onrecordingcomplete?: (audioBlob: Blob, duration: number) => void;
		maxDuration?: number; // seconds
	}

	let {
		onrecordingcomplete,
		maxDuration = 300 // 5 minutes default
	}: Props = $props();

	let isRecording = $state(false);
	let isPaused = $state(false);
	let duration = $state(0);
	let mediaRecorder: MediaRecorder | null = null;
	let audioChunks: Blob[] = [];
	let stream: MediaStream | null = null;
	let timerInterval: number | null = null;

	// Format duration as MM:SS
	const formattedDuration = $derived(() => {
		const minutes = Math.floor(duration / 60);
		const seconds = duration % 60;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	});

	async function startRecording() {
		try {
			// Request microphone access
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			
			// Create MediaRecorder
			mediaRecorder = new MediaRecorder(stream);
			audioChunks = [];

			mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					audioChunks.push(event.data);
				}
			};

			mediaRecorder.onstop = () => {
				const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
				onrecordingcomplete?.(audioBlob, duration);
				cleanup();
			};

			// Start recording
			mediaRecorder.start();
			isRecording = true;
			duration = 0;

			// Start timer
			timerInterval = window.setInterval(() => {
				duration++;
				if (duration >= maxDuration) {
					stopRecording();
				}
			}, 1000);

		} catch (error) {
			console.error('Failed to start recording:', error);
			alert('Failed to access microphone. Please check permissions.');
		}
	}

	function pauseRecording() {
		if (mediaRecorder && mediaRecorder.state === 'recording') {
			mediaRecorder.pause();
			isPaused = true;
			if (timerInterval) {
				clearInterval(timerInterval);
				timerInterval = null;
			}
		}
	}

	function resumeRecording() {
		if (mediaRecorder && mediaRecorder.state === 'paused') {
			mediaRecorder.resume();
			isPaused = false;
			timerInterval = window.setInterval(() => {
				duration++;
				if (duration >= maxDuration) {
					stopRecording();
				}
			}, 1000);
		}
	}

	function stopRecording() {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop();
			isRecording = false;
			isPaused = false;
		}
	}

	function cleanup() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
		if (stream) {
			stream.getTracks().forEach(track => track.stop());
			stream = null;
		}
	}

	function handleClick() {
		if (!isRecording) {
			startRecording();
		} else if (isPaused) {
			resumeRecording();
		} else {
			stopRecording();
		}
	}
</script>

<div class="flex flex-col items-center gap-4">
	<!-- Recording Button -->
	<button
		onclick={handleClick}
		class="relative w-20 h-20 rounded-full transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-amber-300"
		class:bg-gradient-to-br={!isRecording}
		class:from-amber-500={!isRecording}
		class:to-amber-600={!isRecording}
		class:bg-red-600={isRecording}
		class:shadow-lg={!isRecording}
		class:shadow-2xl={isRecording}
		class:animate-pulse={isRecording && !isPaused}
		aria-label={isRecording ? (isPaused ? 'Resume recording' : 'Stop recording') : 'Start recording'}
	>
		{#if !isRecording}
			<!-- Microphone Icon -->
			<svg class="w-10 h-10 mx-auto text-white" fill="currentColor" viewBox="0 0 24 24">
				<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
				<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
			</svg>
		{:else if isPaused}
			<!-- Play Icon -->
			<svg class="w-10 h-10 mx-auto text-white" fill="currentColor" viewBox="0 0 24 24">
				<path d="M8 5v14l11-7z"/>
			</svg>
		{:else}
			<!-- Stop Icon -->
			<svg class="w-8 h-8 mx-auto text-white" fill="currentColor" viewBox="0 0 24 24">
				<rect x="6" y="6" width="12" height="12"/>
			</svg>
		{/if}

		{#if isRecording}
			<!-- Pulsing Ring -->
			<div class="absolute inset-0 rounded-full border-4 border-red-400 animate-ping opacity-75"></div>
		{/if}
	</button>

	<!-- Timer -->
	{#if isRecording}
		<div class="flex items-center gap-3">
			<div class="text-2xl font-mono font-bold text-neutral-900">
				{formattedDuration()}
			</div>
			{#if !isPaused}
				<button
					onclick={pauseRecording}
					class="p-2 rounded-full hover:bg-neutral-100 transition-colors"
					aria-label="Pause recording"
				>
					<svg class="w-5 h-5 text-neutral-700" fill="currentColor" viewBox="0 0 24 24">
						<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
					</svg>
				</button>
			{/if}
		</div>
	{/if}

	<!-- Status Text -->
	<p class="text-sm text-neutral-600 text-center">
		{#if !isRecording}
			Tap to start recording
		{:else if isPaused}
			Recording paused
		{:else}
			Recording in progress...
		{/if}
	</p>
</div>
