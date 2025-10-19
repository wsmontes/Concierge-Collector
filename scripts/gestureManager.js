/**
 * Gesture Manager
 * Purpose: Handle swipe gestures and touch interactions for mobile UX
 * 
 * Features:
 * - Swipe detection (left, right, up, down)
 * - Swipe velocity and distance tracking
 * - Long press detection
 * - Pull-to-refresh support
 * - Configurable thresholds
 * - Touch-friendly event delegation
 * 
 * Dependencies:
 * - None (standalone component)
 * 
 * Usage:
 *   gestureManager.onSwipe(element, {
 *     onSwipeLeft: () => console.log('Swiped left'),
 *     onSwipeRight: () => console.log('Swiped right'),
 *     threshold: 50
 *   });
 * 
 * Author: Concierge Collector Team
 * Last Updated: October 19, 2025
 */

(function() {
    'use strict';

    /**
     * GestureManager - Centralized touch gesture handling
     */
    const GestureManager = {
        // Configuration
        config: {
            swipeThreshold: 50,      // Minimum distance in pixels
            swipeVelocity: 0.3,      // Minimum velocity in pixels/ms
            longPressDelay: 500,     // Long press detection time in ms
            pullRefreshThreshold: 80 // Pull-to-refresh activation distance
        },

        // Active gestures tracking
        activeGestures: new Map(),

        /**
         * Initialize gesture tracking on an element
         * @param {HTMLElement} element - Element to track
         * @param {Object} options - Gesture configuration
         * @returns {string} Gesture ID for cleanup
         */
        onSwipe(element, options = {}) {
            if (!element) {
                console.error('GestureManager: Element is required');
                return null;
            }

            const gestureId = this.generateId();
            const config = {
                onSwipeLeft: options.onSwipeLeft || null,
                onSwipeRight: options.onSwipeRight || null,
                onSwipeUp: options.onSwipeUp || null,
                onSwipeDown: options.onSwipeDown || null,
                threshold: options.threshold || this.config.swipeThreshold,
                velocity: options.velocity || this.config.swipeVelocity,
                preventDefault: options.preventDefault !== false
            };

            // Touch tracking state
            const state = {
                startX: 0,
                startY: 0,
                endX: 0,
                endY: 0,
                startTime: 0,
                endTime: 0,
                isSwiping: false
            };

            // Touch start handler
            const handleTouchStart = (e) => {
                const touch = e.touches[0];
                state.startX = touch.clientX;
                state.startY = touch.clientY;
                state.startTime = Date.now();
                state.isSwiping = false;

                element.classList.add('swiping');
            };

            // Touch move handler
            const handleTouchMove = (e) => {
                if (!state.startTime) return;

                const touch = e.touches[0];
                state.endX = touch.clientX;
                state.endY = touch.clientY;

                const deltaX = Math.abs(state.endX - state.startX);
                const deltaY = Math.abs(state.endY - state.startY);

                // Detect if user is swiping
                if (deltaX > 10 || deltaY > 10) {
                    state.isSwiping = true;

                    if (config.preventDefault) {
                        e.preventDefault();
                    }
                }
            };

            // Touch end handler
            const handleTouchEnd = (e) => {
                if (!state.startTime) return;

                state.endTime = Date.now();
                element.classList.remove('swiping');

                const deltaX = state.endX - state.startX;
                const deltaY = state.endY - state.startY;
                const deltaTime = state.endTime - state.startTime;

                const distanceX = Math.abs(deltaX);
                const distanceY = Math.abs(deltaY);
                const velocityX = distanceX / deltaTime;
                const velocityY = distanceY / deltaTime;

                // Determine swipe direction
                if (distanceX > distanceY) {
                    // Horizontal swipe
                    if (distanceX >= config.threshold && velocityX >= config.velocity) {
                        if (deltaX > 0 && config.onSwipeRight) {
                            config.onSwipeRight({
                                distance: distanceX,
                                velocity: velocityX,
                                duration: deltaTime
                            });
                        } else if (deltaX < 0 && config.onSwipeLeft) {
                            config.onSwipeLeft({
                                distance: distanceX,
                                velocity: velocityX,
                                duration: deltaTime
                            });
                        }
                    }
                } else {
                    // Vertical swipe
                    if (distanceY >= config.threshold && velocityY >= config.velocity) {
                        if (deltaY > 0 && config.onSwipeDown) {
                            config.onSwipeDown({
                                distance: distanceY,
                                velocity: velocityY,
                                duration: deltaTime
                            });
                        } else if (deltaY < 0 && config.onSwipeUp) {
                            config.onSwipeUp({
                                distance: distanceY,
                                velocity: velocityY,
                                duration: deltaTime
                            });
                        }
                    }
                }

                // Reset state
                state.startX = 0;
                state.startY = 0;
                state.endX = 0;
                state.endY = 0;
                state.startTime = 0;
                state.isSwiping = false;
            };

            // Attach event listeners
            element.addEventListener('touchstart', handleTouchStart, { passive: !config.preventDefault });
            element.addEventListener('touchmove', handleTouchMove, { passive: !config.preventDefault });
            element.addEventListener('touchend', handleTouchEnd, { passive: true });

            // Store for cleanup
            this.activeGestures.set(gestureId, {
                element,
                handlers: { handleTouchStart, handleTouchMove, handleTouchEnd }
            });

            return gestureId;
        },

        /**
         * Add long press detection to an element
         * @param {HTMLElement} element - Element to track
         * @param {Function} callback - Callback when long press detected
         * @param {number} delay - Long press delay in ms
         * @returns {string} Gesture ID
         */
        onLongPress(element, callback, delay = this.config.longPressDelay) {
            if (!element || !callback) {
                console.error('GestureManager: Element and callback are required');
                return null;
            }

            const gestureId = this.generateId();
            let pressTimer = null;
            let startX = 0;
            let startY = 0;

            const handleTouchStart = (e) => {
                const touch = e.touches[0];
                startX = touch.clientX;
                startY = touch.clientY;

                pressTimer = setTimeout(() => {
                    callback(e);
                    element.classList.add('long-pressed');
                }, delay);
            };

            const handleTouchMove = (e) => {
                const touch = e.touches[0];
                const deltaX = Math.abs(touch.clientX - startX);
                const deltaY = Math.abs(touch.clientY - startY);

                // Cancel if finger moved too much
                if (deltaX > 10 || deltaY > 10) {
                    clearTimeout(pressTimer);
                }
            };

            const handleTouchEnd = () => {
                clearTimeout(pressTimer);
                element.classList.remove('long-pressed');
            };

            element.addEventListener('touchstart', handleTouchStart, { passive: true });
            element.addEventListener('touchmove', handleTouchMove, { passive: true });
            element.addEventListener('touchend', handleTouchEnd, { passive: true });
            element.addEventListener('touchcancel', handleTouchEnd, { passive: true });

            this.activeGestures.set(gestureId, {
                element,
                handlers: { handleTouchStart, handleTouchMove, handleTouchEnd }
            });

            return gestureId;
        },

        /**
         * Add pull-to-refresh functionality
         * @param {HTMLElement} container - Scrollable container
         * @param {Function} onRefresh - Callback when refresh triggered
         * @returns {string} Gesture ID
         */
        onPullRefresh(container, onRefresh) {
            if (!container || !onRefresh) {
                console.error('GestureManager: Container and callback are required');
                return null;
            }

            const gestureId = this.generateId();
            let startY = 0;
            let currentY = 0;
            let isPulling = false;

            // Create refresh indicator
            const indicator = document.createElement('div');
            indicator.className = 'pull-to-refresh';
            indicator.innerHTML = '<span class="material-icons">refresh</span>';
            container.style.position = 'relative';
            container.insertBefore(indicator, container.firstChild);

            const handleTouchStart = (e) => {
                // Only activate if at top of scroll
                if (container.scrollTop === 0) {
                    startY = e.touches[0].clientY;
                    isPulling = true;
                }
            };

            const handleTouchMove = (e) => {
                if (!isPulling) return;

                currentY = e.touches[0].clientY;
                const pullDistance = currentY - startY;

                if (pullDistance > 0 && container.scrollTop === 0) {
                    e.preventDefault();
                    
                    // Update indicator position
                    const progress = Math.min(pullDistance / this.config.pullRefreshThreshold, 1);
                    indicator.style.top = `${-60 + (pullDistance * 0.5)}px`;
                    indicator.style.opacity = progress;
                    indicator.style.transform = `translateX(-50%) rotate(${pullDistance * 2}deg)`;

                    if (pullDistance >= this.config.pullRefreshThreshold) {
                        indicator.classList.add('active');
                    } else {
                        indicator.classList.remove('active');
                    }
                }
            };

            const handleTouchEnd = () => {
                if (!isPulling) return;

                const pullDistance = currentY - startY;

                if (pullDistance >= this.config.pullRefreshThreshold) {
                    // Trigger refresh
                    indicator.style.top = '20px';
                    indicator.classList.add('active');
                    
                    Promise.resolve(onRefresh()).finally(() => {
                        // Reset indicator
                        setTimeout(() => {
                            indicator.style.top = '-60px';
                            indicator.style.opacity = '0';
                            indicator.style.transform = 'translateX(-50%) rotate(0deg)';
                            indicator.classList.remove('active');
                        }, 500);
                    });
                } else {
                    // Reset indicator
                    indicator.style.top = '-60px';
                    indicator.style.opacity = '0';
                    indicator.style.transform = 'translateX(-50%) rotate(0deg)';
                    indicator.classList.remove('active');
                }

                isPulling = false;
                startY = 0;
                currentY = 0;
            };

            container.addEventListener('touchstart', handleTouchStart, { passive: true });
            container.addEventListener('touchmove', handleTouchMove, { passive: false });
            container.addEventListener('touchend', handleTouchEnd, { passive: true });

            this.activeGestures.set(gestureId, {
                element: container,
                handlers: { handleTouchStart, handleTouchMove, handleTouchEnd },
                indicator
            });

            return gestureId;
        },

        /**
         * Remove gesture tracking
         * @param {string} gestureId - ID returned from onSwipe/onLongPress
         */
        off(gestureId) {
            const gesture = this.activeGestures.get(gestureId);
            if (!gesture) return;

            const { element, handlers, indicator } = gesture;

            // Remove event listeners
            Object.values(handlers).forEach(handler => {
                element.removeEventListener('touchstart', handler);
                element.removeEventListener('touchmove', handler);
                element.removeEventListener('touchend', handler);
                element.removeEventListener('touchcancel', handler);
            });

            // Remove indicator if present
            if (indicator) {
                indicator.remove();
            }

            this.activeGestures.delete(gestureId);
        },

        /**
         * Remove all gesture tracking
         */
        offAll() {
            this.activeGestures.forEach((_, gestureId) => {
                this.off(gestureId);
            });
        },

        /**
         * Generate unique gesture ID
         * @returns {string} Unique ID
         */
        generateId() {
            return `gesture-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        },

        /**
         * Helper to make lists swipeable (e.g., swipe to delete)
         * @param {string} selector - CSS selector for list items
         * @param {Object} options - Configuration options
         */
        makeListSwipeable(selector, options = {}) {
            const items = document.querySelectorAll(selector);
            const swipeDistance = options.swipeDistance || 100;
            const onSwipeLeft = options.onSwipeLeft || null;
            const onSwipeRight = options.onSwipeRight || null;

            items.forEach(item => {
                this.onSwipe(item, {
                    threshold: swipeDistance,
                    onSwipeLeft: onSwipeLeft ? () => onSwipeLeft(item) : null,
                    onSwipeRight: onSwipeRight ? () => onSwipeRight(item) : null,
                    preventDefault: true
                });
            });
        }
    };

    // Expose to global scope
    window.gestureManager = GestureManager;

    console.log('✅ GestureManager initialized');
})();
