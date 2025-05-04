/**
 * Main application initialization
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing application...');
    
    // Check if required libraries and components exist
    if (typeof Dexie === 'undefined') {
        console.error('Dexie.js library not loaded!');
        alert('Required library Dexie.js not loaded. Please check your internet connection and reload the page.');
        return;
    }
    
    // Initialize the application components in the correct order
    try {
        // Check and log if global instances exist
        if (typeof dataStorage === 'undefined') {
            console.error('dataStorage not available. Creating a new instance...');
            window.dataStorage = new DataStorage();
        }
        
        if (typeof apiHandler === 'undefined') {
            console.error('apiHandler not available. Creating a new instance...');
            window.apiHandler = new ApiHandler();
        }
        
        if (typeof conceptMatcher === 'undefined') {
            console.error('conceptMatcher not available. Creating a new instance...');
            window.conceptMatcher = new ConceptMatcher();
        }
        
        if (typeof uiManager === 'undefined') {
            console.error('uiManager not available. Creating a new instance...');
            window.uiManager = new UIManager();
        }
        
        // Initialize UI Manager (which will set up all the event handlers)
        console.log('Initializing UI Manager...');
        uiManager.init();
        
        // Add a test click handler to the save button to verify it works
        const saveButton = document.getElementById('save-curator');
        if (saveButton) {
            console.log('Adding test click handler to save button');
            saveButton.addEventListener('click', function() {
                console.log('Save button clicked!');
            });
        }
        
        // Preload the concept matching model in the background
        setTimeout(() => {
            conceptMatcher.loadModel().catch(error => {
                console.error('Error preloading model:', error);
            });
        }, 2000);
        
        console.log('Restaurant Curator application initialized');
    } catch (error) {
        console.error('Error during application initialization:', error);
        alert('There was an error initializing the application. Please check the console for details.');
    }
});
