/**
 * Pending Audio Modal
 * 
 * Purpose: Full management UI for pending/failed audio recordings.
 * Allows users to view, retry, delete, and bulk-manage audio recordings
 * that are waiting for transcription or have failed.
 * 
 * Dependencies: PendingAudioManager, RecordingModule (for retry via processRecording)
 * 
 * Design: Follows the same dynamic modal pattern as FindEntityModal.
 */

window.PendingAudioModal = class PendingAudioModal {
    constructor() {
        this.modal = null;
        this.listContainer = null;
        this.isOpen = false;
        this.audios = [];
        this._objectUrls = []; // Track blob URLs for cleanup
        this.initialize();
    }

    // ─── Bootstrap ──────────────────────────────────────────────

    initialize() {
        this.injectStyles();
    }

    injectStyles() {
        if (document.getElementById('pending-audio-modal-styles')) return;

        const style = document.createElement('style');
        style.id = 'pending-audio-modal-styles';
        style.textContent = `
            /* ===== Pending Audio Modal ===== */
            #pending-audio-modal,
            #pending-audio-modal *,
            #pending-audio-modal *::before,
            #pending-audio-modal *::after {
                box-sizing: border-box;
            }

            #pending-audio-modal {
                position: fixed;
                inset: 0;
                z-index: var(--z-modal-backdrop, 1040);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1rem;
                background: rgba(0,0,0,0.45);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                overflow: hidden;
                animation: pamFadeIn 250ms ease-out;
            }

            @keyframes pamFadeIn {
                from { opacity: 0; }
                to   { opacity: 1; }
            }

            @keyframes pamSlideUp {
                from { transform: translateY(20px); opacity: 0; }
                to   { transform: translateY(0); opacity: 1; }
            }

            #pending-audio-modal .pam-dialog {
                background: var(--color-surface, #fff);
                border-radius: var(--radius-xl, 16px);
                box-shadow: var(--shadow-xl, 0 20px 60px rgba(0,0,0,.25));
                width: 100%;
                max-width: 560px;
                max-height: 85vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                animation: pamSlideUp 300ms ease-out;
            }

            /* ── Header ───────────────────── */
            #pending-audio-modal .pam-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 1.25rem 1.5rem;
                border-bottom: 1px solid var(--color-border, #e5e7eb);
                background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                color: white;
                border-radius: var(--radius-xl, 16px) var(--radius-xl, 16px) 0 0;
            }

            #pending-audio-modal .pam-header h2 {
                margin: 0;
                font-size: 1.125rem;
                font-weight: 700;
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }

            #pending-audio-modal .pam-close-btn {
                background: rgba(255,255,255,.2);
                border: none;
                border-radius: 50%;
                width: 36px;
                height: 36px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: white;
                transition: background 200ms;
            }
            #pending-audio-modal .pam-close-btn:hover {
                background: rgba(255,255,255,.35);
            }

            /* ── Summary bar ──────────────── */
            #pending-audio-modal .pam-summary {
                display: flex;
                gap: 0.75rem;
                padding: 0.75rem 1.5rem;
                background: var(--color-surface-alt, #f9fafb);
                border-bottom: 1px solid var(--color-border, #e5e7eb);
                flex-wrap: wrap;
            }

            #pending-audio-modal .pam-stat {
                display: flex;
                align-items: center;
                gap: 0.35rem;
                font-size: 0.8rem;
                font-weight: 600;
                padding: 0.25rem 0.6rem;
                border-radius: 9999px;
            }
            #pending-audio-modal .pam-stat.pending  { background: #fef3c7; color: #92400e; }
            #pending-audio-modal .pam-stat.failed    { background: #fee2e2; color: #991b1b; }
            #pending-audio-modal .pam-stat.retrying   { background: #dbeafe; color: #1e40af; }
            #pending-audio-modal .pam-stat.processing { background: #e0e7ff; color: #3730a3; }
            #pending-audio-modal .pam-stat.transcribed{ background: #d1fae5; color: #065f46; }

            /* ── List ─────────────────────── */
            #pending-audio-modal .pam-list {
                flex: 1;
                overflow-y: auto;
                padding: 1rem 1.5rem;
            }

            #pending-audio-modal .pam-empty {
                text-align: center;
                padding: 3rem 1rem;
                color: #9ca3af;
            }
            #pending-audio-modal .pam-empty .material-icons {
                font-size: 3rem;
                margin-bottom: 0.75rem;
                display: block;
            }

            #pending-audio-modal .pam-card {
                background: var(--color-surface, #fff);
                border: 1px solid var(--color-border, #e5e7eb);
                border-radius: var(--radius-lg, 12px);
                padding: 1rem;
                margin-bottom: 0.75rem;
                transition: box-shadow 200ms, border-color 200ms;
            }
            #pending-audio-modal .pam-card:hover {
                box-shadow: 0 4px 12px rgba(0,0,0,.08);
                border-color: #d1d5db;
            }
            #pending-audio-modal .pam-card:last-child { margin-bottom: 0; }

            #pending-audio-modal .pam-card-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 0.5rem;
            }

            #pending-audio-modal .pam-card-status {
                display: inline-flex;
                align-items: center;
                gap: 0.25rem;
                font-size: 0.75rem;
                font-weight: 600;
                padding: 0.2rem 0.5rem;
                border-radius: 9999px;
            }
            #pending-audio-modal .pam-card-status.pending    { background: #fef3c7; color: #92400e; }
            #pending-audio-modal .pam-card-status.failed     { background: #fee2e2; color: #991b1b; }
            #pending-audio-modal .pam-card-status.retrying    { background: #dbeafe; color: #1e40af; }
            #pending-audio-modal .pam-card-status.processing  { background: #e0e7ff; color: #3730a3; }
            #pending-audio-modal .pam-card-status.transcribed { background: #d1fae5; color: #065f46; }

            #pending-audio-modal .pam-card-meta {
                font-size: 0.8rem;
                color: #6b7280;
                margin-bottom: 0.5rem;
                display: flex;
                flex-wrap: wrap;
                gap: 0.75rem;
            }
            #pending-audio-modal .pam-card-meta span {
                display: flex;
                align-items: center;
                gap: 0.2rem;
            }
            #pending-audio-modal .pam-card-meta .material-icons {
                font-size: 0.9rem;
            }

            #pending-audio-modal .pam-card-error {
                font-size: 0.75rem;
                color: #dc2626;
                background: #fef2f2;
                padding: 0.4rem 0.6rem;
                border-radius: 6px;
                margin-bottom: 0.5rem;
                display: flex;
                align-items: flex-start;
                gap: 0.3rem;
            }
            #pending-audio-modal .pam-card-error .material-icons {
                font-size: 0.85rem;
                flex-shrink: 0;
                margin-top: 1px;
            }

            /* ── Audio player ─────────────── */
            #pending-audio-modal .pam-card-player {
                margin-bottom: 0.5rem;
            }
            #pending-audio-modal .pam-card-player audio {
                width: 100%;
                height: 36px;
                border-radius: 8px;
            }

            #pending-audio-modal .pam-card-actions {
                display: flex;
                gap: 0.5rem;
                flex-wrap: wrap;
            }

            #pending-audio-modal .pam-btn {
                display: inline-flex;
                align-items: center;
                gap: 0.3rem;
                padding: 0.4rem 0.75rem;
                border-radius: 8px;
                font-size: 0.8rem;
                font-weight: 600;
                border: none;
                cursor: pointer;
                transition: all 200ms;
            }
            #pending-audio-modal .pam-btn .material-icons { font-size: 1rem; }

            #pending-audio-modal .pam-btn-retry {
                background: #dbeafe;
                color: #1e40af;
            }
            #pending-audio-modal .pam-btn-retry:hover {
                background: #bfdbfe;
            }
            #pending-audio-modal .pam-btn-retry:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            #pending-audio-modal .pam-btn-delete {
                background: #fee2e2;
                color: #991b1b;
            }
            #pending-audio-modal .pam-btn-delete:hover {
                background: #fecaca;
            }

            #pending-audio-modal .pam-btn-download {
                background: #e0e7ff;
                color: #3730a3;
            }
            #pending-audio-modal .pam-btn-download:hover {
                background: #c7d2fe;
            }

            /* ── Footer ──────────────────── */
            #pending-audio-modal .pam-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0.75rem 1.5rem;
                border-top: 1px solid var(--color-border, #e5e7eb);
                background: var(--color-surface-alt, #f9fafb);
                gap: 0.5rem;
                flex-wrap: wrap;
            }

            #pending-audio-modal .pam-btn-footer {
                display: inline-flex;
                align-items: center;
                gap: 0.3rem;
                padding: 0.5rem 1rem;
                border-radius: 8px;
                font-size: 0.8rem;
                font-weight: 600;
                border: none;
                cursor: pointer;
                transition: all 200ms;
            }
            #pending-audio-modal .pam-btn-footer .material-icons { font-size: 1rem; }

            #pending-audio-modal .pam-btn-clear-all {
                background: #fee2e2;
                color: #991b1b;
            }
            #pending-audio-modal .pam-btn-clear-all:hover { background: #fecaca; }

            #pending-audio-modal .pam-btn-retry-all {
                background: #dbeafe;
                color: #1e40af;
            }
            #pending-audio-modal .pam-btn-retry-all:hover { background: #bfdbfe; }

            #pending-audio-modal .pam-btn-close {
                background: var(--color-surface, #fff);
                color: #374151;
                border: 1px solid #d1d5db;
            }
            #pending-audio-modal .pam-btn-close:hover { background: #f3f4f6; }

            /* ── Animations ──────────────── */
            @keyframes pamSpin {
                from { transform: rotate(0deg); }
                to   { transform: rotate(360deg); }
            }
            #pending-audio-modal .pam-spin {
                animation: pamSpin 1s linear infinite;
            }

            #pending-audio-modal .pam-card-removing {
                animation: pamCardRemove 300ms ease-in forwards;
            }
            @keyframes pamCardRemove {
                to { opacity: 0; height: 0; padding: 0; margin: 0; overflow: hidden; }
            }
        `;
        document.head.appendChild(style);
    }

    // ─── Open / Close ───────────────────────────────────────────

    async open() {
        if (this.isOpen) return;
        this.isOpen = true;

        // Build the modal DOM on each open (fresh state)
        this.buildModal();
        document.body.appendChild(this.modal);
        document.body.style.overflow = 'hidden';

        // Load data
        await this.refresh();
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;

        // Revoke all object URLs to free memory
        this._objectUrls.forEach(url => URL.revokeObjectURL(url));
        this._objectUrls = [];

        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        document.body.style.overflow = '';

        // Refresh the badge on the recording section
        if (window.uiManager?.recordingModule?.showPendingAudioBadge) {
            window.uiManager.recordingModule.showPendingAudioBadge();
        }
    }

    // ─── Build DOM ──────────────────────────────────────────────

    buildModal() {
        const el = document.createElement('div');
        el.id = 'pending-audio-modal';
        el.innerHTML = `
            <div class="pam-dialog" role="dialog" aria-labelledby="pam-title">
                <!-- Header -->
                <div class="pam-header">
                    <h2 id="pam-title">
                        <span class="material-icons">playlist_play</span>
                        Pending Recordings
                    </h2>
                    <button class="pam-close-btn" aria-label="Close" id="pam-close-x">
                        <span class="material-icons">close</span>
                    </button>
                </div>

                <!-- Summary stats -->
                <div class="pam-summary" id="pam-summary"></div>

                <!-- Audio list -->
                <div class="pam-list" id="pam-list">
                    <div class="pam-empty">
                        <span class="material-icons">hourglass_empty</span>
                        Loading...
                    </div>
                </div>

                <!-- Footer -->
                <div class="pam-footer" id="pam-footer"></div>
            </div>
        `;

        this.modal = el;
        this.listContainer = el.querySelector('#pam-list');

        // Close handlers
        el.querySelector('#pam-close-x').addEventListener('click', () => this.close());
        el.addEventListener('click', (e) => {
            if (e.target === el) this.close();
        });
        document.addEventListener('keydown', this._escHandler = (e) => {
            if (e.key === 'Escape') this.close();
        }, { once: true });
    }

    // ─── Data Loading ──────────────────────────────────────────

    async refresh() {
        if (!window.PendingAudioManager) return;

        try {
            const [audios, counts] = await Promise.all([
                window.PendingAudioManager.getAudios(),
                window.PendingAudioManager.getAudioCounts()
            ]);

            this.audios = audios.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            this.renderSummary(counts);
            this.renderList();
            this.renderFooter(counts);
        } catch (error) {
            console.error('Error loading pending audios:', error);
            this.listContainer.innerHTML = `
                <div class="pam-empty">
                    <span class="material-icons" style="color:#dc2626">error</span>
                    <p>Failed to load recordings</p>
                </div>
            `;
        }
    }

    // ─── Render helpers ─────────────────────────────────────────

    renderSummary(counts) {
        const summaryEl = this.modal.querySelector('#pam-summary');
        if (!summaryEl) return;

        const stats = [];
        if (counts.pending) stats.push(`<span class="pam-stat pending"><span class="material-icons" style="font-size:.85rem">schedule</span> ${counts.pending} pending</span>`);
        if (counts.processing) stats.push(`<span class="pam-stat processing"><span class="material-icons" style="font-size:.85rem">sync</span> ${counts.processing} processing</span>`);
        if (counts.retrying) stats.push(`<span class="pam-stat retrying"><span class="material-icons" style="font-size:.85rem">replay</span> ${counts.retrying} retrying</span>`);
        if (counts.failed) stats.push(`<span class="pam-stat failed"><span class="material-icons" style="font-size:.85rem">error_outline</span> ${counts.failed} failed</span>`);
        if (counts.transcribed) stats.push(`<span class="pam-stat transcribed"><span class="material-icons" style="font-size:.85rem">check_circle</span> ${counts.transcribed} done</span>`);

        summaryEl.innerHTML = stats.length > 0 ? stats.join('') : '<span style="color:#9ca3af;font-size:.85rem">No recordings</span>';
    }

    renderList() {
        if (!this.listContainer) return;

        if (this.audios.length === 0) {
            this.listContainer.innerHTML = `
                <div class="pam-empty">
                    <span class="material-icons">check_circle</span>
                    <p style="font-weight:600;color:#374151">All clear!</p>
                    <p style="font-size:.85rem">No pending recordings to manage.</p>
                </div>
            `;
            return;
        }

        // Revoke old object URLs before re-render
        this._objectUrls.forEach(url => URL.revokeObjectURL(url));
        this._objectUrls = [];

        this.listContainer.innerHTML = this.audios.map(audio => this.renderCard(audio)).join('');

        // Create audio players with blob URLs
        this.listContainer.querySelectorAll('.pam-card-player[data-audio-id]').forEach(container => {
            const audioId = parseInt(container.dataset.audioId, 10);
            const audio = this.audios.find(a => a.id === audioId);
            if (audio?.audioBlob) {
                const url = URL.createObjectURL(audio.audioBlob);
                this._objectUrls.push(url);
                const el = document.createElement('audio');
                el.controls = true;
                el.preload = 'metadata';
                el.src = url;
                container.appendChild(el);
            }
        });

        this.attachCardListeners();
    }

    renderCard(audio) {
        const statusIcon = {
            pending: 'schedule',
            processing: 'sync',
            retrying: 'replay',
            failed: 'error_outline',
            transcribed: 'check_circle',
            completed: 'done_all'
        }[audio.status] || 'help';

        const timeAgo = this.formatTimeAgo(audio.timestamp);
        const blobSize = audio.audioBlob ? this.formatBytes(audio.audioBlob.size || 0) : 'N/A';
        const canRetry = ['pending', 'failed'].includes(audio.status);

        let errorHtml = '';
        if (audio.lastError) {
            const truncatedError = audio.lastError.length > 120
                ? audio.lastError.substring(0, 120) + '…'
                : audio.lastError;
            errorHtml = `
                <div class="pam-card-error">
                    <span class="material-icons">warning</span>
                    <span>${this.escapeHtml(truncatedError)}</span>
                </div>
            `;
        }

        const hasBlob = !!audio.audioBlob;

        return `
            <div class="pam-card" data-audio-id="${audio.id}">
                <div class="pam-card-header">
                    <span class="pam-card-status ${audio.status}">
                        <span class="material-icons" style="font-size:.85rem">${statusIcon}</span>
                        ${audio.status}
                    </span>
                    <span style="font-size:.75rem;color:#9ca3af">#${audio.id}</span>
                </div>

                <div class="pam-card-meta">
                    <span><span class="material-icons">access_time</span>${timeAgo}</span>
                    <span><span class="material-icons">storage</span>${blobSize}</span>
                    ${audio.retryCount > 0 ? `<span><span class="material-icons">replay</span>${audio.retryCount} retries</span>` : ''}
                    ${audio.isAdditional ? '<span><span class="material-icons">add_circle</span>Additional</span>' : ''}
                </div>

                ${hasBlob ? `<div class="pam-card-player" data-audio-id="${audio.id}"></div>` : ''}

                ${errorHtml}

                <div class="pam-card-actions">
                    ${canRetry ? `
                        <button class="pam-btn pam-btn-retry" data-action="retry" data-id="${audio.id}">
                            <span class="material-icons">refresh</span>
                            Retry
                        </button>
                    ` : ''}
                    ${hasBlob ? `
                        <button class="pam-btn pam-btn-download" data-action="download" data-id="${audio.id}">
                            <span class="material-icons">download</span>
                            MP3
                        </button>
                    ` : ''}
                    <button class="pam-btn pam-btn-delete" data-action="delete" data-id="${audio.id}">
                        <span class="material-icons">delete</span>
                        Delete
                    </button>
                </div>
            </div>
        `;
    }

    renderFooter(counts) {
        const footerEl = this.modal.querySelector('#pam-footer');
        if (!footerEl) return;

        const actionableCount = counts.pending + counts.failed;
        const totalCount = counts.total;

        footerEl.innerHTML = `
            <div style="display:flex;gap:.5rem">
                ${actionableCount > 0 ? `
                    <button class="pam-btn-footer pam-btn-retry-all" id="pam-retry-all">
                        <span class="material-icons">replay</span>
                        Retry All (${actionableCount})
                    </button>
                ` : ''}
                ${totalCount > 0 ? `
                    <button class="pam-btn-footer pam-btn-clear-all" id="pam-clear-all">
                        <span class="material-icons">delete_sweep</span>
                        Clear All
                    </button>
                ` : ''}
            </div>
            <button class="pam-btn-footer pam-btn-close" id="pam-close-footer">
                Close
            </button>
        `;

        // Attach footer listeners
        footerEl.querySelector('#pam-close-footer')?.addEventListener('click', () => this.close());
        footerEl.querySelector('#pam-retry-all')?.addEventListener('click', () => this.retryAll());
        footerEl.querySelector('#pam-clear-all')?.addEventListener('click', () => this.clearAll());
    }

    // ─── Card event listeners ───────────────────────────────────

    attachCardListeners() {
        if (!this.listContainer) return;

        this.listContainer.querySelectorAll('.pam-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const action = btn.dataset.action;
                const id = parseInt(btn.dataset.id, 10);

                if (action === 'retry') {
                    await this.retryAudio(id, btn);
                } else if (action === 'delete') {
                    await this.deleteAudio(id, btn);
                } else if (action === 'download') {
                    this.downloadAudio(id);
                }
            });
        });
    }

    // ─── Actions ────────────────────────────────────────────────

    async retryAudio(id, btn) {
        const card = btn.closest('.pam-card');
        const originalHtml = btn.innerHTML;

        try {
            btn.disabled = true;
            btn.innerHTML = '<span class="material-icons pam-spin">refresh</span> Retrying…';

            const audio = await window.PendingAudioManager.getAudio(id);
            if (!audio || !audio.audioBlob) {
                throw new Error('Audio data not found');
            }

            // Reset status for retry
            await window.PendingAudioManager.updateAudio(id, {
                retryCount: 0,
                status: 'pending',
                lastError: null
            });

            // Use RecordingModule's processRecording method
            if (window.uiManager?.recordingModule) {
                await window.uiManager.recordingModule.processRecording(audio.audioBlob, id);

                // Success — animate card out and refresh
                card.classList.add('pam-card-removing');
                setTimeout(() => this.refresh(), 350);

                this.showToast('Transcription successful!', 'success');
            } else {
                throw new Error('Recording module not available');
            }
        } catch (error) {
            console.error('Retry failed:', error);
            btn.disabled = false;
            btn.innerHTML = originalHtml;

            // Update error on the card
            await window.PendingAudioManager.updateAudio(id, {
                status: 'failed',
                lastError: error.message
            });
            await this.refresh();

            this.showToast(`Retry failed: ${error.message}`, 'error');
        }
    }

    async deleteAudio(id, btn) {
        const card = btn.closest('.pam-card');

        try {
            card.classList.add('pam-card-removing');

            await new Promise(r => setTimeout(r, 250));
            await window.PendingAudioManager.deleteAudio(id);
            await this.refresh();

            this.showToast('Recording deleted', 'success');
        } catch (error) {
            console.error('Delete failed:', error);
            card?.classList.remove('pam-card-removing');
            this.showToast('Failed to delete recording', 'error');
        }
    }

    async retryAll() {
        const actionable = this.audios.filter(a => ['pending', 'failed'].includes(a.status));
        if (actionable.length === 0) return;

        const btn = this.modal.querySelector('#pam-retry-all');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="material-icons pam-spin">refresh</span> Retrying…';
        }

        let successCount = 0;
        let failCount = 0;

        for (const audio of actionable) {
            try {
                if (!audio.audioBlob) continue;

                await window.PendingAudioManager.updateAudio(audio.id, {
                    retryCount: 0, status: 'pending', lastError: null
                });

                if (window.uiManager?.recordingModule) {
                    await window.uiManager.recordingModule.processRecording(audio.audioBlob, audio.id);
                    successCount++;
                }
            } catch (error) {
                failCount++;
                await window.PendingAudioManager.updateAudio(audio.id, {
                    status: 'failed', lastError: error.message
                });
            }
        }

        await this.refresh();
        this.showToast(`Retry complete: ${successCount} succeeded, ${failCount} failed`, successCount > 0 ? 'success' : 'error');
    }

    async clearAll() {
        if (!confirm('Delete all pending recordings? This cannot be undone.')) return;

        try {
            const ids = this.audios.map(a => a.id);
            for (const id of ids) {
                await window.PendingAudioManager.deleteAudio(id);
            }
            await this.refresh();
            this.showToast(`Cleared ${ids.length} recordings`, 'success');
        } catch (error) {
            console.error('Clear all failed:', error);
            this.showToast('Failed to clear recordings', 'error');
        }
    }

    /**
     * Download audio blob as MP3 file
     */
    downloadAudio(id) {
        const audio = this.audios.find(a => a.id === id);
        if (!audio?.audioBlob) {
            this.showToast('Audio data not available', 'error');
            return;
        }

        try {
            const blob = new Blob([audio.audioBlob], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);

            const ts = audio.timestamp
                ? new Date(audio.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19)
                : 'recording';
            const filename = `pending-audio-${ts}.mp3`;

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.showToast('Download started', 'success');
        } catch (error) {
            console.error('Download failed:', error);
            this.showToast('Failed to download audio', 'error');
        }
    }

    // ─── Utilities ──────────────────────────────────────────────

    formatTimeAgo(timestamp) {
        const now = new Date();
        const then = new Date(timestamp);
        const diffMs = now - then;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMs / 3600000);
        const diffDay = Math.floor(diffMs / 86400000);

        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHr < 24) return `${diffHr}h ago`;
        if (diffDay < 7) return `${diffDay}d ago`;
        return then.toLocaleDateString();
    }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    showToast(message, type = 'info') {
        if (typeof Toastify !== 'undefined') {
            const bg = type === 'success'
                ? 'linear-gradient(to right, #00b09b, #96c93d)'
                : type === 'error'
                    ? 'linear-gradient(to right, #ff5f6d, #ffc371)'
                    : 'linear-gradient(to right, #667eea, #764ba2)';
            Toastify({ text: message, duration: 3500, gravity: 'top', position: 'center', style: { background: bg } }).showToast();
        } else if (window.uiUtils?.showNotification) {
            window.uiUtils.showNotification(message, type);
        }
    }
};
