/**
 * Diagnose API health and CORS issues
 * Run in browser console
 */

(async function diagnoseAPI() {
    console.group('🏥 API Health Diagnosis');
    
    // Test 1: Check configuration
    console.log('\n📋 Test 1: Configuration Check');
    console.log('Environment:', window.location.hostname);
    console.log('AppConfig.api.backend.baseUrl:', window.AppConfig?.api?.backend?.baseUrl);
    console.log('ApiService.baseUrl:', window.ApiService?.baseUrl);
    console.log('Is Render Production:', window.location.hostname.includes('onrender.com'));
    
    // Test 2: Try /health endpoint (should be CORS-enabled and no auth required)
    console.log('\n❤️ Test 2: Health Check');
    const apiBase = window.AppConfig?.api?.backend?.baseUrl || 'https://concierge-collector.onrender.com/api/v3';
    const healthUrl = `${apiBase}/health`;
    
    console.log('Trying:', healthUrl);
    
    try {
        const response = await fetch(healthUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        console.log('Status:', response.status, response.statusText);
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ API is ONLINE:', data);
        } else {
            console.error('❌ API returned error:', response.status);
            const text = await response.text();
            console.error('Response:', text);
        }
    } catch (error) {
        console.error('❌ Health check failed:', error.message);
        
        if (error.message.includes('Failed to fetch')) {
            console.error('🚫 Possible causes:');
            console.error('  1. API server is offline');
            console.error('  2. CORS not configured on backend');
            console.error('  3. Network connectivity issue');
        }
    }
    
    // Test 3: Try /info endpoint
    console.log('\n📄 Test 3: Info Check');
    const infoUrl = `${apiBase}/info`;
    console.log('Trying:', infoUrl);
    
    try {
        const response = await fetch(infoUrl);
        console.log('Status:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ API info:', data);
        } else {
            console.error('❌ Info endpoint failed:', response.status);
        }
    } catch (error) {
        console.error('❌ Info check failed:', error.message);
    }
    
    // Test 4: Check if backend URL is accessible at all
    console.log('\n🌐 Test 4: Check Backend Status');
    const backendRoot = 'https://concierge-collector.onrender.com';
    console.log('Trying backend root:', backendRoot);
    
    try {
        const response = await fetch(backendRoot);
        console.log('Backend root status:', response.status);
        
        if (response.ok) {
            console.log('✅ Backend server is responding');
        } else if (response.status === 404) {
            console.log('⚠️ Backend responds but root path not found (expected)');
        } else {
            console.warn('⚠️ Backend returned:', response.status);
        }
    } catch (error) {
        console.error('❌ Backend not accessible:', error.message);
        console.error('🚨 BACKEND IS DOWN OR UNREACHABLE');
    }
    
    // Test 5: Check local database
    console.log('\n💾 Test 5: Local Database Check');
    if (window.DataStore?.db) {
        const entityCount = await window.DataStore.db.entities.count();
        const curationCount = await window.DataStore.db.curations.count();
        console.log(`Entities: ${entityCount}`);
        console.log(`Curations: ${curationCount}`);
        
        if (curationCount === 0 && entityCount > 0) {
            console.warn('⚠️ You have entities but NO curations locally');
            console.warn('   This suggests curations were never synced from server');
        }
    }
    
    // Recommendations
    console.log('\n💡 Recommendations:');
    console.log('1. Check if backend API is online: https://concierge-collector.onrender.com/api/v3/health');
    console.log('2. Check backend CORS configuration allows: ' + window.location.origin);
    console.log('3. If backend is down, wait for it to wake up (Render free tier sleeps)');
    console.log('4. Once API is accessible, run: SyncManagerV3.fullSync() to pull curations');
    
    console.groupEnd();
})();
