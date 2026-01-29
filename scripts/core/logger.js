/**
 * File: logger.js
 * Purpose: Centralized logging utility with debug mode control
 * Dependencies: AppConfig (optional)
 * Last Updated: October 19, 2025
 * 
 * Provides a unified logging interface that can be toggled on/off
 * and filtered by log level for production vs development environments.
 */

const Logger = (function() {
    'use strict';

    // Get debug mode from AppConfig or localStorage
    let debugMode = false;
    
    // Try to read from AppConfig first
    if (typeof window.AppConfig !== 'undefined' && window.AppConfig.app) {
        debugMode = window.AppConfig.isDevelopment ? window.AppConfig.isDevelopment() : false;
    }
    
    // Allow override from localStorage
    try {
        const stored = localStorage.getItem('debug_mode');
        if (stored !== null) {
            debugMode = stored === 'true';
        }
    } catch (e) {
        // Ignore localStorage errors
    }

    // Log levels (higher number = more important)
    const LogLevel = {
        DEBUG: 0,    // Detailed debugging information
        INFO: 1,     // General information
        WARN: 2,     // Warning messages
        ERROR: 3,    // Error messages
        CRITICAL: 4  // Critical errors only
    };

    // Current log level (INFO in production, DEBUG in development)
    let currentLogLevel = debugMode ? LogLevel.DEBUG : LogLevel.INFO;

    // Module prefixes for organized logging
    const modules = {};

    /**
     * Format a log message with timestamp and module prefix
     */
    function formatMessage(module, level, message, ...args) {
        const timestamp = new Date().toLocaleTimeString();
        const levelName = Object.keys(LogLevel).find(key => LogLevel[key] === level);
        const prefix = module ? `[${timestamp}] [${module}] [${levelName}]` : `[${timestamp}] [${levelName}]`;
        return [prefix, message, ...args];
    }

    /**
     * Core logging function
     */
    function log(level, module, message, ...args) {
        // Skip if log level is below threshold
        if (level < currentLogLevel) {
            return;
        }

        const formattedArgs = formatMessage(module, level, message, ...args);

        // Route to appropriate console method
        switch (level) {
            case LogLevel.DEBUG:
                console.log(...formattedArgs);
                break;
            case LogLevel.INFO:
                console.log(...formattedArgs);
                break;
            case LogLevel.WARN:
                console.warn(...formattedArgs);
                break;
            case LogLevel.ERROR:
            case LogLevel.CRITICAL:
                console.error(...formattedArgs);
                break;
            default:
                console.log(...formattedArgs);
        }
    }

    /**
     * Public API
     */
    return {
        /**
         * Log levels enum
         */
        Level: LogLevel,

        /**
         * Enable/disable debug mode
         */
        setDebugMode(enabled) {
            debugMode = enabled;
            currentLogLevel = enabled ? LogLevel.DEBUG : LogLevel.INFO;
            try {
                localStorage.setItem('debug_mode', enabled);
            } catch (e) {
                // Ignore localStorage errors
            }
            this.info('Logger', `Debug mode ${enabled ? 'enabled' : 'disabled'}`);
        },

        /**
         * Set log level
         */
        setLevel(level) {
            if (typeof level === 'number' && level >= 0 && level <= LogLevel.CRITICAL) {
                currentLogLevel = level;
                this.info('Logger', `Log level set to ${Object.keys(LogLevel).find(key => LogLevel[key] === level)}`);
            }
        },

        /**
         * Get current log level
         */
        getLevel() {
            return currentLogLevel;
        },

        /**
         * Check if debug mode is enabled
         */
        isDebugMode() {
            return debugMode;
        },

        /**
         * Create a module logger
         */
        module(moduleName) {
            if (!modules[moduleName]) {
                modules[moduleName] = {
                    debug: (msg, ...args) => log(LogLevel.DEBUG, moduleName, msg, ...args),
                    info: (msg, ...args) => log(LogLevel.INFO, moduleName, msg, ...args),
                    warn: (msg, ...args) => log(LogLevel.WARN, moduleName, msg, ...args),
                    error: (msg, ...args) => log(LogLevel.ERROR, moduleName, msg, ...args),
                    critical: (msg, ...args) => log(LogLevel.CRITICAL, moduleName, msg, ...args)
                };
            }
            return modules[moduleName];
        },

        /**
         * Global logging methods (use module() instead for better organization)
         */
        debug(message, ...args) {
            log(LogLevel.DEBUG, null, message, ...args);
        },

        info(message, ...args) {
            log(LogLevel.INFO, null, message, ...args);
        },

        warn(message, ...args) {
            log(LogLevel.WARN, null, message, ...args);
        },

        error(message, ...args) {
            log(LogLevel.ERROR, null, message, ...args);
        },

        critical(message, ...args) {
            log(LogLevel.CRITICAL, null, message, ...args);
        },

        /**
         * Group logging (useful for related messages)
         */
        group(label) {
            if (debugMode) {
                console.group(label);
            }
        },

        groupEnd() {
            if (debugMode) {
                console.groupEnd();
            }
        },

        /**
         * Table logging (useful for arrays/objects)
         */
        table(data) {
            if (debugMode && currentLogLevel <= LogLevel.DEBUG) {
                console.table(data);
            }
        },

        /**
         * Performance timing
         */
        time(label) {
            if (debugMode) {
                console.time(label);
            }
        },

        timeEnd(label) {
            if (debugMode) {
                console.timeEnd(label);
            }
        }
    };
})();

// Make Logger globally available
window.Logger = Logger;

// Log initialization
Logger.info('Logger', 'Centralized logging system initialized', {
    debugMode: Logger.isDebugMode(),
    logLevel: Object.keys(Logger.Level).find(key => Logger.Level[key] === Logger.getLevel())
});

// Add keyboard shortcut to toggle debug mode (Ctrl+Shift+D)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        Logger.setDebugMode(!Logger.isDebugMode());
        SafetyUtils && SafetyUtils.showNotification 
            ? SafetyUtils.showNotification(`Debug mode ${Logger.isDebugMode() ? 'enabled' : 'disabled'}`, 'info')
            : alert(`Debug mode ${Logger.isDebugMode() ? 'enabled' : 'disabled'}`);
    }
});
