/**
 * Test if curations API is working and returning data
 * Run this in the browser console after page loads
 */

(async function testCurationsAPI() {
    console.group('🧪 Testing Curations API');
    
    try {
        // Check if ApiService is available
        if (!window.ApiService) {
            console.error('❌ ApiService not available');
            console.groupEnd();
            return;
        }
        
        console.log('✅ ApiService available');
        
        // Test 1: List all curations
        console.log('\n📋 Test 1: List ALL curations from server');
        try {
            const allCurations = await window.ApiService.listCurations({
                limit: 100,
                offset: 0
            });
            
            console.log('Response:', allCurations);
            
            if (allCurations && allCurations.items) {
                console.log(`✅ Got ${allCurations.items.length} curations from server`);
                
                if (allCurations.items.length > 0) {
                    console.log('\n📄 First 3 curations:');
                    allCurations.items.slice(0, 3).forEach(c => {
                        console.log(`  - ${c.curation_id}`);
                        console.log(`    Entity: ${c.entity_id}`);
                        console.log(`    Category: ${c.category}`);
                        console.log(`    Curator: ${c.curator_id}`);
                    });
                } else {
                    console.warn('⚠️ Server returned 0 curations - database may be empty');
                }
            } else {
                console.error('❌ Unexpected response format:', allCurations);
            }
        } catch (error) {
            console.error('❌ Error listing curations:', error);
            console.error('Error details:', error.message);
            console.error('Stack:', error.stack);
        }
        
        // Test 2: Get curations for TESTE_NASA entity
        console.log('\n📋 Test 2: Get curations for TESTE_NASA entity');
        try {
            const testeNasaCurations = await window.ApiService.getEntityCurations('rest_teste_nasa_1770698630896');
            console.log('Response:', testeNasaCurations);
            
            if (testeNasaCurations && testeNasaCurations.items) {
                console.log(`✅ TESTE_NASA has ${testeNasaCurations.items.length} curation(s)`);
                
                if (testeNasaCurations.items.length > 0) {
                    testeNasaCurations.items.forEach(c => {
                        console.log(`  - ${c.curation_id}: ${c.category} / ${c.concept}`);
                    });
                } else {
                    console.warn('⚠️ TESTE_NASA has NO curations on server');
                }
            } else {
                console.error('❌ Unexpected response format:', testeNasaCurations);
            }
        } catch (error) {
            console.error('❌ Error getting entity curations:', error);
        }
        
        // Test 3: Check API base URL
        console.log('\n🌐 Test 3: API Configuration');
        console.log('Base URL:', window.ApiService?.config?.baseUrl || 'not configured');
        console.log('Environment:', window.AppConfig?.environment?.mode || 'not configured');
        
        // Test 4: Make raw fetch request to see exact response
        console.log('\n🔍 Test 4: Raw fetch to /curations/search');
        try {
            const baseUrl = window.ApiService?.config?.baseUrl || window.AppConfig?.api?.backend?.baseUrl;
            const url = `${baseUrl}/curations/search?limit=10&offset=0`;
            console.log('Fetching:', url);
            
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('Status:', response.status);
            console.log('Status Text:', response.statusText);
            
            const data = await response.json();
            console.log('Raw response data:', data);
            
            if (response.ok) {
                console.log(`✅ API returned successfully with ${data.items?.length || 0} items`);
            } else {
                console.error('❌ API returned error:', data);
            }
        } catch (error) {
            console.error('❌ Raw fetch failed:', error);
        }
        
    } catch (error) {
        console.error('❌ Test suite failed:', error);
    }
    
    console.groupEnd();
})();
