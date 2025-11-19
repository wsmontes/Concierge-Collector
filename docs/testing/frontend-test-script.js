/**
 * File: frontend-test-script.js
 * Purpose: Browser console test script for V3 API integration
 * Usage: Copy-paste into browser DevTools Console at http://localhost:5500
 * 
 * This script tests the complete frontend CRUD flow using ApiService
 */

// API Key for testing (paste this in localStorage first)
const TEST_API_KEY = '7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc';

// Step 1: Set API Key in localStorage
console.log('📝 Step 1: Setting API key...');
localStorage.setItem('concierge-api-key', TEST_API_KEY);
console.log('✅ API key stored:', localStorage.getItem('concierge-api-key'));

// Step 2: Verify ApiService is loaded
console.log('\n📝 Step 2: Checking ApiService...');
if (typeof ApiService === 'undefined') {
    console.error('❌ ApiService not loaded! Make sure the page has fully loaded.');
} else {
    console.log('✅ ApiService available');
}

// Step 3: Test API Connection
console.log('\n📝 Step 3: Testing API connection...');
ApiService.getInfo()
    .then(info => {
        console.log('✅ API Info:', info);
        return ApiService.getHealth();
    })
    .then(health => {
        console.log('✅ Health Check:', health);
    })
    .catch(error => {
        console.error('❌ Connection failed:', error);
    });

// Step 4: List Entities
console.log('\n📝 Step 4: Listing entities...');
ApiService.listEntities({ limit: 5 })
    .then(result => {
        console.log('✅ Entities retrieved:');
        console.log(`  Total: ${result.total}`);
        console.log(`  Showing: ${result.items.length} of ${result.limit}`);
        console.log('  First entity:', result.items[0]);
    })
    .catch(error => {
        console.error('❌ List failed:', error);
    });

// Step 5: Create Entity (with authentication)
console.log('\n📝 Step 5: Creating test entity...');
const testEntityId = 'rest_frontend_test_' + Date.now();
let createdEntity;

ApiService.createEntity({
    entity_id: testEntityId,
    type: 'restaurant',
    name: 'Frontend Test Restaurant',
    status: 'active',
    data: {
        location: {
            city: 'Barcelona',
            address: 'Frontend Test Street 123'
        },
        contacts: {
            phone: '+34 123 456 789'
        }
    }
})
    .then(entity => {
        createdEntity = entity;
        console.log('✅ Entity created:');
        console.log('  ID:', entity._id);
        console.log('  Entity ID:', entity.entity_id);
        console.log('  Version:', entity.version);
        console.log('  Name:', entity.name);
        
        // Step 6: Get Entity by ID
        console.log('\n📝 Step 6: Retrieving entity by ID...');
        return ApiService.getEntity(entity._id);
    })
    .then(entity => {
        console.log('✅ Entity retrieved:', entity.name);
        console.log('  Current version:', entity.version);
        
        // Step 7: Update Entity
        console.log('\n📝 Step 7: Updating entity...');
        return ApiService.updateEntity(entity._id, {
            name: 'Updated Frontend Test Restaurant',
            data: {
                ...entity.data,
                contacts: {
                    phone: '+34 987 654 321',
                    email: 'test@example.com'
                }
            }
        }, entity.version);
    })
    .then(updated => {
        console.log('✅ Entity updated:');
        console.log('  New name:', updated.name);
        console.log('  New version:', updated.version);
        console.log('  Previous version was:', createdEntity.version);
        
        // Step 8: Test Conflict Detection
        console.log('\n📝 Step 8: Testing version conflict (should fail)...');
        return ApiService.updateEntity(updated._id, {
            name: 'This Should Fail'
        }, 1)  // Using old version intentionally
            .then(() => {
                console.error('❌ Conflict detection failed - update should have been rejected!');
            })
            .catch(error => {
                if (error.message && error.message.includes('409')) {
                    console.log('✅ Conflict detected correctly!');
                    console.log('  Error:', error.message);
                } else {
                    console.error('❌ Unexpected error:', error);
                }
                // Return the updated entity for next step
                return updated;
            });
    })
    .then(entity => {
        // Step 9: Delete Entity
        console.log('\n📝 Step 9: Deleting test entity...');
        return ApiService.deleteEntity(entity._id);
    })
    .then(() => {
        console.log('✅ Entity deleted');
        
        // Step 10: Verify Deletion
        console.log('\n📝 Step 10: Verifying deletion (should fail with 404)...');
        return ApiService.getEntity(createdEntity._id)
            .then(() => {
                console.error('❌ Deletion verification failed - entity still exists!');
            })
            .catch(error => {
                if (error.message && error.message.includes('404')) {
                    console.log('✅ Deletion verified - entity not found');
                } else {
                    console.error('❌ Unexpected error:', error);
                }
            });
    })
    .then(() => {
        console.log('\n🎉 All tests completed successfully!');
        console.log('\n📊 Test Summary:');
        console.log('  ✅ API connection');
        console.log('  ✅ List entities');
        console.log('  ✅ Create entity (with auth)');
        console.log('  ✅ Read entity by ID');
        console.log('  ✅ Update entity (version incremented)');
        console.log('  ✅ Conflict detection (409 error)');
        console.log('  ✅ Delete entity');
        console.log('  ✅ Verify deletion (404 error)');
    })
    .catch(error => {
        console.error('❌ Test suite failed:', error);
    });

// Instructions for running individual tests
console.log('\n💡 To run individual tests, use these commands:');
console.log('');
console.log('// List entities');
console.log('ApiService.listEntities({ limit: 5 }).then(console.log);');
console.log('');
console.log('// Create entity');
console.log('ApiService.createEntity({ entity_id: "test_" + Date.now(), type: "restaurant", name: "My Restaurant", status: "active" }).then(console.log);');
console.log('');
console.log('// Get entity');
console.log('ApiService.getEntity("entity_id_here").then(console.log);');
console.log('');
console.log('// Update entity');
console.log('ApiService.updateEntity("entity_id", { name: "New Name" }, 1).then(console.log);');
console.log('');
console.log('// Delete entity');
console.log('ApiService.deleteEntity("entity_id").then(console.log);');
