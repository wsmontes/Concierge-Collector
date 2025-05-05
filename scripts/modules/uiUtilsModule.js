/**
 * Handles UI utility functions like loading indicators and notifications
 */
class UIUtilsModule {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    showLoading(message = 'Loading...') {
        // Remove any existing loading overlay
        this.hideLoading();
        
        const loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'loading-overlay';
        loadingOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        loadingOverlay.innerHTML = `
            <div class="bg-white p-4 rounded-lg shadow-lg flex flex-col items-center">
                <div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                <p class="text-gray-800">${message}</p>
            </div>
        `;
        
        document.body.appendChild(loadingOverlay);
        document.body.style.overflow = 'hidden';
    }

    hideLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            document.body.removeChild(loadingOverlay);
            document.body.style.overflow = '';
        }
    }

    showNotification(message, type = 'success') {
        const backgroundColor = type === 'success' 
            ? 'linear-gradient(to right, #00b09b, #96c93d)' 
            : 'linear-gradient(to right, #ff5f6d, #ffc371)';
            
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: "right",
            style: { background: backgroundColor }
        }).showToast();
    }

    getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by your browser'));
                return;
            }
            
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            });
        });
    }
}
