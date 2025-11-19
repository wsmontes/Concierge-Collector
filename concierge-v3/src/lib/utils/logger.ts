/**
 * Logger Utility
 * Purpose: Enhanced logging for DevTools integration
 * 
 * Features:
 *   - Structured logs with context
 *   - Performance timing
 *   - Error tracking
 *   - API call monitoring
 * 
 * Usage:
 *   import { logger } from '$lib/utils/logger';
 *   logger.info('User logged in', { userId: 123 });
 *   logger.api('POST /curations', { status: 200, duration: 150 });
 */

export const logger = {
	/**
	 * General information log
	 */
	info(message: string, data?: any) {
		console.log(`ℹ️ ${message}`, data || '');
	},

	/**
	 * Success log
	 */
	success(message: string, data?: any) {
		console.log(`✅ ${message}`, data || '');
	},

	/**
	 * Error log
	 */
	error(message: string, error?: any) {
		console.error(`❌ ${message}`, error || '');
	},

	/**
	 * Warning log
	 */
	warn(message: string, data?: any) {
		console.warn(`⚠️ ${message}`, data || '');
	},

	/**
	 * API call log
	 */
	api(endpoint: string, details?: { method?: string; status?: number; duration?: number; data?: any }) {
		const method = details?.method || 'GET';
		const status = details?.status || 0;
		const duration = details?.duration || 0;
		
		const emoji = status >= 400 ? '🔴' : status >= 200 && status < 300 ? '🟢' : '🟡';
		console.log(`${emoji} API ${method} ${endpoint}`, {
			status,
			duration: `${duration}ms`,
			...(details?.data ? { data: details.data } : {})
		});
	},

	/**
	 * Store action log
	 */
	store(storeName: string, action: string, data?: any) {
		console.log(`🗄️ Store [${storeName}] ${action}`, data || '');
	},

	/**
	 * Component lifecycle log
	 */
	component(componentName: string, event: string, data?: any) {
		console.log(`🎨 Component [${componentName}] ${event}`, data || '');
	},

	/**
	 * Performance timing
	 */
	time(label: string) {
		console.time(`⏱️ ${label}`);
	},

	timeEnd(label: string) {
		console.timeEnd(`⏱️ ${label}`);
	},

	/**
	 * Database operation log
	 */
	db(operation: string, table: string, data?: any) {
		console.log(`💾 DB [${table}] ${operation}`, data || '');
	},

	/**
	 * User action log
	 */
	action(actionName: string, data?: any) {
		console.log(`👆 User Action: ${actionName}`, data || '');
	}
};
