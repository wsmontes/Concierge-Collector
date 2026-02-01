/**
 * Image Processing Service - Manages image AI processing queue
 * 
 * Purpose: Queue-based image processing with AI analysis
 * 
 * Main Responsibilities:
 * - Manage image processing queue
 * - Call AI image analysis API
 * - Handle batch processing
 * - Track processing status
 * 
 * Dependencies: apiUtils, errorHandling
 */

class ImageProcessingService {
    constructor() {
        this.log = Logger.module('ImageProcessingService');
        
        // Processing queue
        this.queue = [];
        this.isProcessing = false;
        this.currentItem = null;
        
        // Processing statistics
        this.stats = {
            total: 0,
            successful: 0,
            failed: 0,
            skipped: 0
        };
        
        // Validate dependencies
        if (!window.apiUtils) {
            throw new Error('apiUtils not loaded');
        }
    }
    
    /**
     * Add image to processing queue
     * @param {Object} imageData - Image data with base64
     * @param {Object} options - Processing options
     * @returns {string} - Queue item ID
     */
    addToQueue(imageData, options = {}) {
        const item = {
            id: this.generateId(),
            imageData,
            options,
            status: 'pending',
            addedAt: new Date(),
            result: null,
            error: null
        };
        
        this.queue.push(item);
        this.stats.total++;
        
        this.log.debug(`Added to queue: ${item.id}, queue size: ${this.queue.length}`);
        
        // Auto-start processing if not already running
        if (!this.isProcessing) {
            this.processQueue().catch(err => {
                this.log.error('Queue processing error:', err);
            });
        }
        
        return item.id;
    }
    
    /**
     * Process image queue
     */
    async processQueue() {
        if (this.isProcessing) {
            this.log.debug('⚠️ Queue already being processed, skipping');
            return;
        }
        
        if (this.queue.length === 0) {
            this.log.debug('✅ Queue empty, nothing to process');
            return;
        }
        
        this.isProcessing = true;
        const totalItems = this.queue.length;
        this.log.debug(`🚀 Starting queue processing: ${totalItems} items`);
        
        while (this.queue.length > 0) {
            const item = this.queue.shift();
            const itemNumber = totalItems - this.queue.length;
            this.currentItem = item;
            
            try {
                item.status = 'processing';
                item.startedAt = new Date();
                
                this.log.debug(`📸 Processing item ${itemNumber}/${totalItems} (ID: ${item.id})`);
                
                const result = await this.processImage(
                    item.imageData,
                    item.options
                );
                
                item.status = 'completed';
                item.result = result;
                item.completedAt = new Date();
                
                this.stats.successful++;
                
                const duration = (item.completedAt - item.startedAt) / 1000;
                this.log.debug(`✅ Item ${itemNumber}/${totalItems} completed in ${duration.toFixed(2)}s`);
                
            } catch (error) {
                this.log.error(`❌ Item ${itemNumber}/${totalItems} failed:`, error.message);
                
                item.status = 'failed';
                item.error = error.message;
                item.completedAt = new Date();
                
                this.stats.failed++;
            }
        }
        
        this.isProcessing = false;
        this.currentItem = null;
        
        this.log.debug('Queue processing complete', this.stats);
    }
    
    /**
     * Process single image with AI
     * @param {Object} imageData - Image data
     * @param {Object} options - Processing options
     * @returns {Promise<Object>} - Processing result
     */
    async processImage(imageData, options = {}) {
        this.log.debug('Processing image with AI', {
            hasBase64: !!imageData.base64,
            format: imageData.format,
            size: imageData.size
        });
        
        // Validate image data
        if (!imageData.base64) {
            throw new Error('Image base64 data is required');
        }
        
        // Prepare API request
        const requestData = {
            image: imageData.base64,
            format: imageData.format || 'jpeg',
            options: {
                extractConcepts: options.extractConcepts !== false,
                detectObjects: options.detectObjects !== false,
                maxConcepts: options.maxConcepts || 10
            }
        };
        
        // Call AI image analysis API
        const response = await window.apiUtils.callAPI('/ai/analyze-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            throw new Error(`Image analysis failed: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        this.log.debug('Image analysis complete', {
            conceptsFound: result.concepts?.length || 0,
            objectsFound: result.objects?.length || 0
        });
        
        return result;
    }
    
    /**
     * Process batch of images
     * @param {Array} images - Array of image data
     * @param {Object} options - Processing options
     * @returns {Promise<Array>} - Results for each image
     */
    async processBatch(images, options = {}) {
        this.log.debug(`Processing batch: ${images.length} images`);
        
        const results = [];
        
        for (const imageData of images) {
            const itemId = this.addToQueue(imageData, options);
            results.push({ itemId, imageData });
        }
        
        // Wait for queue to complete
        await this.waitForQueue();
        
        return results;
    }
    
    /**
     * Wait for queue to complete
     * @param {number} timeout - Max wait time in ms
     * @returns {Promise<void>}
     */
    async waitForQueue(timeout = 60000) {
        const startTime = Date.now();
        
        while (this.isProcessing || this.queue.length > 0) {
            if (Date.now() - startTime > timeout) {
                throw new Error('Queue processing timeout');
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    /**
     * Get queue status
     * @returns {Object} - Queue status
     */
    getStatus() {
        return {
            queueSize: this.queue.length,
            isProcessing: this.isProcessing,
            currentItem: this.currentItem ? {
                id: this.currentItem.id,
                status: this.currentItem.status
            } : null,
            stats: { ...this.stats }
        };
    }
    
    /**
     * Get queue size
     * @returns {number}
     */
    getQueueSize() {
        return this.queue.length;
    }
    
    /**
     * Clear queue
     */
    clearQueue() {
        this.queue = [];
        this.log.debug('Queue cleared');
    }
    
    /**
     * Get processing statistics
     * @returns {Object}
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            total: 0,
            successful: 0,
            failed: 0,
            skipped: 0
        };
        this.log.debug('Stats reset');
    }
    
    /**
     * Generate unique ID
     * @returns {string}
     */
    generateId() {
        return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

window.ImageProcessingService = ImageProcessingService;
console.debug('[ImageProcessingService] Service initialized');
