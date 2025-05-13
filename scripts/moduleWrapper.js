/**
 * Module Wrapper Utility
 * Ensures modules are only defined once to avoid duplicate declaration errors
 */

const ModuleWrapper = {
    /**
     * Safely defines a JavaScript class in the global scope only if it doesn't already exist
     * @param {string} className - The name of the class to define
     * @param {Function} classDefinition - The class constructor function
     * @returns {Function} - The class constructor (either existing or newly defined)
     */
    defineClass: function(className, classDefinition) {
        if (!window[className]) {
            console.log(`Defining class: ${className}`);
            window[className] = classDefinition;
        } else {
            console.log(`Class ${className} already defined, skipping definition`);
        }
        return window[className];
    },
    
    /**
     * Safely creates a singleton instance in the global scope only if it doesn't already exist
     * @param {string} instanceName - The name of the instance variable
     * @param {string} className - The name of the class to instantiate
     * @param {Array} args - Arguments to pass to the constructor (optional)
     * @returns {Object} - The instance (either existing or newly created)
     */
    createInstance: function(instanceName, className, ...args) {
        if (!window[instanceName]) {
            console.log(`Creating instance: ${instanceName}`);
            if (window[className]) {
                window[instanceName] = new window[className](...args);
            } else {
                console.error(`Cannot create instance of undefined class: ${className}`);
            }
        } else {
            console.log(`Instance ${instanceName} already exists, using existing instance`);
        }
        return window[instanceName];
    }
};
