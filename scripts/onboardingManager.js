/**
 * Onboarding Manager
 * Purpose: Guide first-time users through app features
 * 
 * Features:
 * - Multi-step onboarding flow
 * - Progress indicator
 * - Skip/restart functionality
 * - Persistent completion tracking
 * - Customizable steps
 * - Modal-based presentation
 * - Feature highlighting
 * 
 * Dependencies:
 * - ModalManager (for displaying steps)
 * 
 * Usage:
 *   onboardingManager.addStep({
 *     title: 'Welcome',
 *     description: 'Get started with Restaurant Collector',
 *     image: '/images/welcome.svg'
 *   });
 *   onboardingManager.start();
 * 
 * Author: Concierge Collector Team
 * Last Updated: October 19, 2025
 */

(function() {
    'use strict';

    /**
     * OnboardingManager - Manage user onboarding experience
     */
    const OnboardingManager = {
        // Onboarding configuration
        steps: [],
        currentStep: 0,
        storageKey: 'onboarding-complete',
        
        // Completion tracking
        get completed() {
            return localStorage.getItem(this.storageKey) === 'true';
        },
        
        set completed(value) {
            localStorage.setItem(this.storageKey, value.toString());
        },

        /**
         * Add onboarding step
         * @param {Object} step - Step configuration
         */
        addStep(step) {
            this.steps.push({
                title: step.title || 'Step',
                description: step.description || '',
                image: step.image || null,
                icon: step.icon || null,
                video: step.video || null,
                highlightElement: step.highlightElement || null,
                onShow: step.onShow || null,
                onHide: step.onHide || null,
                ...step
            });
        },

        /**
         * Start onboarding flow
         * @param {boolean} force - Force restart even if completed
         * @returns {Promise} Resolves when onboarding completes
         */
        async start(force = false) {
            if (this.completed && !force) {
                console.log('Onboarding already completed');
                return;
            }

            if (this.steps.length === 0) {
                console.warn('OnboardingManager: No steps defined');
                return;
            }

            this.currentStep = 0;

            // Show each step
            for (let i = 0; i < this.steps.length; i++) {
                this.currentStep = i;
                const shouldContinue = await this.showStep(this.steps[i]);
                
                if (!shouldContinue) {
                    // User skipped onboarding
                    this.reset();
                    return;
                }
            }

            // Mark as complete
            this.complete();
        },

        /**
         * Show a single onboarding step
         * @param {Object} step - Step to show
         * @returns {Promise<boolean>} True if should continue, false if skipped
         */
        async showStep(step) {
            return new Promise((resolve) => {
                // Call onShow callback
                if (typeof step.onShow === 'function') {
                    step.onShow(step);
                }

                // Highlight element if specified
                if (step.highlightElement) {
                    this.highlightElement(step.highlightElement);
                }

                // Build step content
                const content = this.buildStepContent(step);
                const footer = this.buildStepFooter();

                // Check if modalManager is available
                if (!window.modalManager) {
                    console.error('OnboardingManager: ModalManager not found');
                    resolve(false);
                    return;
                }

                // Open modal
                const modalId = window.modalManager.open({
                    title: this.buildStepTitle(),
                    content,
                    footer,
                    size: 'md',
                    closeOnOverlay: false,
                    showCloseButton: false,
                    className: 'onboarding-modal'
                });

                // Setup button handlers
                const modalEl = document.getElementById(modalId);
                if (!modalEl) {
                    resolve(false);
                    return;
                }

                modalEl.addEventListener('click', (e) => {
                    const action = e.target.closest('[data-action]')?.dataset.action;
                    
                    if (action === 'next') {
                        // Call onHide callback
                        if (typeof step.onHide === 'function') {
                            step.onHide(step);
                        }
                        
                        // Remove highlight
                        this.removeHighlight();
                        
                        // Close modal and continue
                        window.modalManager.close(modalId);
                        resolve(true);
                    } else if (action === 'skip') {
                        // Remove highlight
                        this.removeHighlight();
                        
                        // Close modal and skip onboarding
                        window.modalManager.close(modalId);
                        resolve(false);
                    } else if (action === 'back' && this.currentStep > 0) {
                        // Remove highlight
                        this.removeHighlight();
                        
                        // Go back
                        window.modalManager.close(modalId);
                        this.currentStep -= 2; // Will be incremented in loop
                        resolve(true);
                    }
                });
            });
        },

        /**
         * Build step title with progress
         * @returns {string} Title HTML
         */
        buildStepTitle() {
            return `Step ${this.currentStep + 1} of ${this.steps.length}`;
        },

        /**
         * Build step content
         * @param {Object} step - Step configuration
         * @returns {string} Content HTML
         */
        buildStepContent(step) {
            return `
                <div class="onboarding-step">
                    ${step.image ? `
                        <img src="${step.image}" alt="${step.title}" class="onboarding-image">
                    ` : ''}
                    ${step.video ? `
                        <video src="${step.video}" autoplay loop muted class="onboarding-video"></video>
                    ` : ''}
                    ${step.icon ? `
                        <div class="onboarding-icon">
                            <span class="material-icons">${step.icon}</span>
                        </div>
                    ` : ''}
                    <h3 class="onboarding-title">${step.title}</h3>
                    <p class="onboarding-description">${step.description}</p>
                    ${this.buildProgressBar()}
                </div>
            `;
        },

        /**
         * Build progress bar
         * @returns {string} Progress bar HTML
         */
        buildProgressBar() {
            const progress = ((this.currentStep + 1) / this.steps.length) * 100;
            return `
                <div class="onboarding-progress">
                    <div class="onboarding-progress-bar" style="width: ${progress}%"></div>
                </div>
            `;
        },

        /**
         * Build step footer with navigation buttons
         * @returns {string} Footer HTML
         */
        buildStepFooter() {
            const isFirst = this.currentStep === 0;
            const isLast = this.currentStep === this.steps.length - 1;

            return `
                <div class="onboarding-footer">
                    ${!isFirst ? '<button class="btn btn-outline" data-action="back">Back</button>' : ''}
                    <button class="btn btn-ghost" data-action="skip">Skip</button>
                    <button class="btn btn-primary" data-action="next">
                        ${isLast ? 'Get Started' : 'Next'}
                    </button>
                </div>
            `;
        },

        /**
         * Highlight element on page
         * @param {string} selector - Element selector
         */
        highlightElement(selector) {
            const element = document.querySelector(selector);
            if (!element) return;

            // Create spotlight overlay
            const spotlight = document.createElement('div');
            spotlight.className = 'onboarding-spotlight';
            spotlight.id = 'onboarding-spotlight';
            document.body.appendChild(spotlight);

            // Position spotlight
            const rect = element.getBoundingClientRect();
            spotlight.style.cssText = `
                position: fixed;
                top: ${rect.top - 10}px;
                left: ${rect.left - 10}px;
                width: ${rect.width + 20}px;
                height: ${rect.height + 20}px;
                border: 3px solid var(--color-primary, #3b82f6);
                border-radius: 8px;
                box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
                z-index: 1049;
                pointer-events: none;
            `;

            // Scroll element into view
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },

        /**
         * Remove element highlight
         */
        removeHighlight() {
            const spotlight = document.getElementById('onboarding-spotlight');
            if (spotlight) {
                spotlight.remove();
            }
        },

        /**
         * Mark onboarding as complete
         */
        complete() {
            this.completed = true;
            this.currentStep = 0;
            
            // Dispatch completion event
            document.dispatchEvent(new CustomEvent('onboarding:complete'));
        },

        /**
         * Reset onboarding (for testing or re-running)
         */
        reset() {
            this.completed = false;
            this.currentStep = 0;
            this.removeHighlight();
            
            // Dispatch reset event
            document.dispatchEvent(new CustomEvent('onboarding:reset'));
        },

        /**
         * Check if onboarding is complete
         * @returns {boolean} True if completed
         */
        isComplete() {
            return this.completed;
        },

        /**
         * Clear all steps
         */
        clearSteps() {
            this.steps = [];
            this.currentStep = 0;
        }
    };

    // Inject onboarding styles
    const injectStyles = () => {
        if (document.getElementById('onboarding-styles')) return;

        const style = document.createElement('style');
        style.id = 'onboarding-styles';
        style.textContent = `
            .onboarding-step {
                text-align: center;
                padding: 2rem 1rem;
            }

            .onboarding-image,
            .onboarding-video {
                max-width: 100%;
                max-height: 300px;
                margin: 0 auto 1.5rem;
                border-radius: 8px;
            }

            .onboarding-icon {
                width: 80px;
                height: 80px;
                margin: 0 auto 1.5rem;
                background: var(--color-primary-50, #eff6ff);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .onboarding-icon .material-icons {
                font-size: 3rem;
                color: var(--color-primary, #3b82f6);
            }

            .onboarding-title {
                font-size: 1.5rem;
                font-weight: 600;
                margin-bottom: 0.75rem;
                color: var(--color-neutral-900, #111827);
            }

            .onboarding-description {
                font-size: 1rem;
                color: var(--color-neutral-600, #6b7280);
                line-height: 1.6;
                margin-bottom: 2rem;
                max-width: 400px;
                margin-left: auto;
                margin-right: auto;
            }

            .onboarding-progress {
                width: 100%;
                height: 4px;
                background: var(--color-neutral-200, #e5e7eb);
                border-radius: 2px;
                overflow: hidden;
                margin-top: 2rem;
            }

            .onboarding-progress-bar {
                height: 100%;
                background: var(--color-primary, #3b82f6);
                transition: width 0.3s ease;
            }

            .onboarding-footer {
                display: flex;
                gap: 0.75rem;
                justify-content: flex-end;
                align-items: center;
            }

            .onboarding-spotlight {
                animation: spotlight-pulse 2s ease-in-out infinite;
            }

            @keyframes spotlight-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }

            @media (max-width: 640px) {
                .onboarding-footer {
                    flex-direction: column;
                }

                .onboarding-footer .btn {
                    width: 100%;
                }
            }
        `;
        document.head.appendChild(style);
    };

    // Initialize styles
    injectStyles();

    // Default onboarding steps (can be overridden)
    OnboardingManager.addStep({
        icon: 'restaurant',
        title: 'Welcome to Restaurant Collector',
        description: 'Capture and curate your dining experiences with ease. Let\'s get you started!'
    });

    OnboardingManager.addStep({
        icon: 'mic',
        title: 'Record or Type',
        description: 'Voice record your review or type it manually - your choice! Our AI extracts key details automatically.'
    });

    OnboardingManager.addStep({
        icon: 'auto_awesome',
        title: 'AI-Powered',
        description: 'Our AI analyzes your reviews and extracts restaurant details, saving you time.'
    });

    OnboardingManager.addStep({
        icon: 'sync',
        title: 'Sync Everywhere',
        description: 'Your collection stays in sync across all your devices. Start on your phone, finish on your computer.'
    });

    // Auto-start on first visit (after a delay to let page load)
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (!OnboardingManager.completed) {
                OnboardingManager.start();
            }
        }, 1000);
    });

    // Expose to global scope
    window.onboardingManager = OnboardingManager;

    console.log('✅ OnboardingManager initialized');
})();
