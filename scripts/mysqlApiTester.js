/**
 * MySQL API Tester Module
 * 
 * Purpose: Test communication with the new MySQL-based Concierge Entities API
 * Responsibilities:
 *   - Test all API endpoints (health, entities, curators, import)
 *   - Verify CRUD operations
 *   - Validate response formats
 *   - Generate detailed test reports
 *   - Provide migration readiness assessment
 * 
 * Dependencies:
 *   - ModuleWrapper (window.ModuleWrapper)
 *   - Fetch API (native browser API)
 * 
 * Usage:
 *   const tester = new window.MySQLApiTester();
 *   await tester.runAllTests();
 */

if (typeof window.MySQLApiTester === 'undefined') {
    const MySQLApiTester = ModuleWrapper.defineClass('MySQLApiTester', class {
        constructor() {
            // API Configuration - IMPORTANT: Using /mysql-api/ prefix for integrated deployment
            this.productionBaseUrl = 'https://wsmontes.pythonanywhere.com/mysql-api';
            this.developmentBaseUrl = 'http://localhost:5001/api';
            this.baseUrl = this.productionBaseUrl; // Default to production
            
            // Test Results Storage
            this.testResults = {
                passed: 0,
                failed: 0,
                total: 0,
                details: [],
                startTime: null,
                endTime: null,
                duration: null
            };
            
            // Test Entity IDs for cleanup
            this.createdEntityIds = [];
        }
        
        /**
         * Set API base URL (production or development)
         * @param {string} environment - 'production' or 'development'
         */
        setEnvironment(environment) {
            if (environment === 'development') {
                this.baseUrl = this.developmentBaseUrl;
                this.log('🔧 Using DEVELOPMENT API: ' + this.baseUrl, 'info');
            } else {
                this.baseUrl = this.productionBaseUrl;
                this.log('🌐 Using PRODUCTION API: ' + this.baseUrl, 'info');
            }
        }
        
        /**
         * Run all API tests
         * @returns {Promise<Object>} Test results summary
         */
        async runAllTests() {
            this.log('🚀 Starting MySQL API Test Suite', 'header');
            this.log('Testing API: ' + this.baseUrl, 'info');
            this.log('=' .repeat(60), 'separator');
            
            this.testResults.startTime = new Date();
            
            try {
                // 1. Health and Info Tests
                await this.testHealthEndpoint();
                await this.testInfoEndpoint();
                
                // 2. Entity CRUD Tests
                await this.testGetEntities();
                await this.testCreateEntity();
                await this.testGetEntityById();
                await this.testUpdateEntity();
                await this.testSearchEntities();
                
                // 3. Curator Tests
                await this.testGetCurators();
                
                // 4. Import Tests
                await this.testImportConciergeV2();
                
                // 5. Cleanup
                await this.cleanupTestEntities();
                
            } catch (error) {
                this.log('❌ Test suite crashed: ' + error.message, 'error');
            }
            
            this.testResults.endTime = new Date();
            this.testResults.duration = (this.testResults.endTime - this.testResults.startTime) / 1000;
            
            this.printSummary();
            return this.testResults;
        }
        
        /**
         * Test health endpoint
         */
        async testHealthEndpoint() {
            const testName = 'Health Check Endpoint';
            this.log(`\n🔍 Testing: ${testName}`, 'test');
            
            try {
                const response = await fetch(`${this.baseUrl}/health`);
                const data = await response.json();
                
                // Verify response structure
                const checks = [
                    { condition: response.ok, message: 'HTTP status is OK (200)' },
                    { condition: data.status === 'healthy', message: 'API status is healthy' },
                    { condition: data.data?.database?.status === 'healthy', message: 'Database is healthy' },
                    { condition: data.timestamp !== undefined, message: 'Timestamp is present' }
                ];
                
                this.verifyChecks(testName, checks, data);
                
            } catch (error) {
                this.recordFailure(testName, error.message);
            }
        }
        
        /**
         * Test info endpoint
         */
        async testInfoEndpoint() {
            const testName = 'API Info Endpoint';
            this.log(`\n🔍 Testing: ${testName}`, 'test');
            
            try {
                const response = await fetch(`${this.baseUrl}/info`);
                const data = await response.json();
                
                const checks = [
                    { condition: response.ok, message: 'HTTP status is OK' },
                    { condition: data.status === 'success', message: 'Status is success' },
                    { condition: data.data?.name !== undefined, message: 'API name is present' },
                    { condition: data.data?.version !== undefined, message: 'API version is present' },
                    { condition: Array.isArray(data.data?.supported_entities), message: 'Supported entities list present' },
                    { condition: data.data?.endpoints !== undefined, message: 'Endpoints information present' }
                ];
                
                this.verifyChecks(testName, checks, data);
                
            } catch (error) {
                this.recordFailure(testName, error.message);
            }
        }
        
        /**
         * Test getting entities with filters
         */
        async testGetEntities() {
            const testName = 'Get Entities (with filters)';
            this.log(`\n🔍 Testing: ${testName}`, 'test');
            
            try {
                const response = await fetch(`${this.baseUrl}/entities?entity_type=restaurant&status=active&page=1&per_page=5`);
                const data = await response.json();
                
                const checks = [
                    { condition: response.ok, message: 'HTTP status is OK' },
                    { condition: data.status === 'success', message: 'Status is success' },
                    { condition: Array.isArray(data.data?.entities), message: 'Entities array present' },
                    { condition: data.data?.pagination !== undefined, message: 'Pagination info present' },
                    { condition: data.data?.filters !== undefined, message: 'Filter info present' }
                ];
                
                this.verifyChecks(testName, checks, data);
                
                if (data.data?.entities?.length > 0) {
                    this.log(`   📊 Found ${data.data.entities.length} entities`, 'success');
                }
                
            } catch (error) {
                this.recordFailure(testName, error.message);
            }
        }
        
        /**
         * Test creating a new entity
         */
        async testCreateEntity() {
            const testName = 'Create New Entity';
            this.log(`\n🔍 Testing: ${testName}`, 'test');
            
            try {
                const newEntity = {
                    entity_type: 'restaurant',
                    name: 'Test Restaurant - API Tester',
                    status: 'active',
                    entity_data: {
                        test: true,
                        created_by_tester: true,
                        timestamp: new Date().toISOString(),
                        categories: ['Italian', 'Fine Dining']
                    },
                    created_by: 'api-tester',
                    updated_by: 'api-tester'
                };
                
                const response = await fetch(`${this.baseUrl}/entities`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(newEntity)
                });
                
                const data = await response.json();
                
                const checks = [
                    { condition: response.status === 201, message: 'HTTP status is 201 (Created)' },
                    { condition: data.status === 'success', message: 'Status is success' },
                    { condition: data.data?.entity_id !== undefined, message: 'Entity ID returned' },
                    { condition: data.data?.entity?.name === newEntity.name, message: 'Entity name matches' },
                    { condition: data.message?.includes('created'), message: 'Success message present' }
                ];
                
                this.verifyChecks(testName, checks, data);
                
                // Store created entity ID for later tests and cleanup
                if (data.data?.entity_id) {
                    this.createdEntityIds.push(data.data.entity_id);
                    this.log(`   📝 Created entity ID: ${data.data.entity_id}`, 'success');
                }
                
            } catch (error) {
                this.recordFailure(testName, error.message);
            }
        }
        
        /**
         * Test getting a specific entity by ID
         */
        async testGetEntityById() {
            const testName = 'Get Entity by ID';
            this.log(`\n🔍 Testing: ${testName}`, 'test');
            
            if (this.createdEntityIds.length === 0) {
                this.log('   ⚠️  Skipped: No entity ID available', 'warning');
                return;
            }
            
            try {
                const entityId = this.createdEntityIds[0];
                const response = await fetch(`${this.baseUrl}/entities/${entityId}`);
                const data = await response.json();
                
                const checks = [
                    { condition: response.ok, message: 'HTTP status is OK' },
                    { condition: data.status === 'success', message: 'Status is success' },
                    { condition: data.data?.id === entityId, message: 'Entity ID matches' },
                    { condition: data.data?.name !== undefined, message: 'Entity has name' },
                    { condition: data.data?.entity_data !== undefined, message: 'Entity data present' },
                    { condition: data.data?.created_at !== undefined, message: 'Created timestamp present' }
                ];
                
                this.verifyChecks(testName, checks, data);
                
            } catch (error) {
                this.recordFailure(testName, error.message);
            }
        }
        
        /**
         * Test updating an entity
         */
        async testUpdateEntity() {
            const testName = 'Update Entity';
            this.log(`\n🔍 Testing: ${testName}`, 'test');
            
            if (this.createdEntityIds.length === 0) {
                this.log('   ⚠️  Skipped: No entity ID available', 'warning');
                return;
            }
            
            try {
                const entityId = this.createdEntityIds[0];
                const updateData = {
                    name: 'Test Restaurant - UPDATED',
                    entity_data: {
                        test: true,
                        updated: true,
                        updated_at: new Date().toISOString()
                    },
                    updated_by: 'api-tester-update'
                };
                
                const response = await fetch(`${this.baseUrl}/entities/${entityId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(updateData)
                });
                
                const data = await response.json();
                
                const checks = [
                    { condition: response.ok, message: 'HTTP status is OK' },
                    { condition: data.status === 'success', message: 'Status is success' },
                    { condition: data.data?.name === updateData.name, message: 'Name was updated' },
                    { condition: data.message?.includes('updated'), message: 'Success message present' }
                ];
                
                this.verifyChecks(testName, checks, data);
                
            } catch (error) {
                this.recordFailure(testName, error.message);
            }
        }
        
        /**
         * Test search functionality
         */
        async testSearchEntities() {
            const testName = 'Search Entities';
            this.log(`\n🔍 Testing: ${testName}`, 'test');
            
            try {
                const response = await fetch(`${this.baseUrl}/entities?search=test&entity_type=restaurant`);
                const data = await response.json();
                
                const checks = [
                    { condition: response.ok, message: 'HTTP status is OK' },
                    { condition: data.status === 'success', message: 'Status is success' },
                    { condition: Array.isArray(data.data?.entities), message: 'Entities array present' },
                    { condition: data.data?.filters?.search !== null, message: 'Search filter applied' }
                ];
                
                this.verifyChecks(testName, checks, data);
                
            } catch (error) {
                this.recordFailure(testName, error.message);
            }
        }
        
        /**
         * Test getting curators
         */
        async testGetCurators() {
            const testName = 'Get Curators';
            this.log(`\n🔍 Testing: ${testName}`, 'test');
            
            try {
                const response = await fetch(`${this.baseUrl}/curators`);
                const data = await response.json();
                
                const checks = [
                    { condition: response.ok, message: 'HTTP status is OK' },
                    { condition: data.status === 'success', message: 'Status is success' },
                    { condition: Array.isArray(data.data?.curators), message: 'Curators array present' }
                ];
                
                this.verifyChecks(testName, checks, data);
                
                if (data.data?.curators?.length > 0) {
                    this.log(`   👥 Found ${data.data.curators.length} curators`, 'success');
                }
                
            } catch (error) {
                this.recordFailure(testName, error.message);
            }
        }
        
        /**
         * Test importing Concierge V2 format
         */
        async testImportConciergeV2() {
            const testName = 'Import Concierge V2 Format';
            this.log(`\n🔍 Testing: ${testName}`, 'test');
            
            try {
                // Create a sample Concierge V2 entity
                const sampleEntity = {
                    metadata: [
                        {
                            type: 'collector',
                            source: 'local',
                            data: {
                                name: 'API Test Import Restaurant',
                                description: 'Test restaurant imported via API tester',
                                location: {
                                    latitude: 40.7128,
                                    longitude: -74.0060,
                                    address: '123 Test Street, New York, NY'
                                },
                                notes: {
                                    private: 'This is a test import',
                                    public: 'Test restaurant for API validation'
                                }
                            }
                        }
                    ],
                    Cuisine: ['Italian', 'Test Cuisine'],
                    'Price Range': ['Moderate'],
                    Mood: ['Casual'],
                    Setting: ['Urban']
                };
                
                const response = await fetch(`${this.baseUrl}/import/concierge-v2`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify([sampleEntity])
                });
                
                const data = await response.json();
                
                const checks = [
                    { condition: response.ok, message: 'HTTP status is OK' },
                    { condition: data.status === 'success', message: 'Status is success' },
                    { condition: data.data?.imported !== undefined, message: 'Imported entities list present' },
                    { condition: data.data?.summary?.successful > 0, message: 'At least one entity imported' },
                    { condition: data.message?.includes('imported'), message: 'Success message present' }
                ];
                
                this.verifyChecks(testName, checks, data);
                
                // Store imported entity IDs for cleanup
                if (data.data?.imported) {
                    data.data.imported.forEach(entity => {
                        if (entity.entity_id) {
                            this.createdEntityIds.push(entity.entity_id);
                            this.log(`   📦 Imported entity ID: ${entity.entity_id}`, 'success');
                        }
                    });
                }
                
            } catch (error) {
                this.recordFailure(testName, error.message);
            }
        }
        
        /**
         * Clean up test entities
         */
        async cleanupTestEntities() {
            if (this.createdEntityIds.length === 0) {
                return;
            }
            
            this.log('\n🧹 Cleaning up test entities...', 'info');
            
            for (const entityId of this.createdEntityIds) {
                try {
                    const response = await fetch(`${this.baseUrl}/entities/${entityId}`, {
                        method: 'DELETE'
                    });
                    
                    if (response.ok) {
                        this.log(`   ✅ Deleted entity ID: ${entityId}`, 'success');
                    } else {
                        this.log(`   ⚠️  Could not delete entity ID: ${entityId}`, 'warning');
                    }
                } catch (error) {
                    this.log(`   ❌ Error deleting entity ID ${entityId}: ${error.message}`, 'error');
                }
            }
        }
        
        /**
         * Verify multiple checks and record result
         */
        verifyChecks(testName, checks, responseData) {
            let allPassed = true;
            const failures = [];
            
            for (const check of checks) {
                if (check.condition) {
                    this.log(`   ✅ ${check.message}`, 'success');
                } else {
                    this.log(`   ❌ ${check.message}`, 'error');
                    failures.push(check.message);
                    allPassed = false;
                }
            }
            
            if (allPassed) {
                this.recordSuccess(testName);
            } else {
                this.recordFailure(testName, failures.join(', '), responseData);
            }
        }
        
        /**
         * Record a successful test
         */
        recordSuccess(testName) {
            this.testResults.passed++;
            this.testResults.total++;
            this.testResults.details.push({
                test: testName,
                status: 'PASSED',
                timestamp: new Date().toISOString()
            });
            this.log(`   ✨ ${testName}: PASSED`, 'pass');
        }
        
        /**
         * Record a failed test
         */
        recordFailure(testName, error, responseData = null) {
            this.testResults.failed++;
            this.testResults.total++;
            this.testResults.details.push({
                test: testName,
                status: 'FAILED',
                error: error,
                response: responseData,
                timestamp: new Date().toISOString()
            });
            this.log(`   ❌ ${testName}: FAILED - ${error}`, 'fail');
        }
        
        /**
         * Print test summary
         */
        printSummary() {
            this.log('\n' + '='.repeat(60), 'separator');
            this.log('📊 TEST SUMMARY', 'header');
            this.log('='.repeat(60), 'separator');
            
            const passRate = this.testResults.total > 0 
                ? ((this.testResults.passed / this.testResults.total) * 100).toFixed(1)
                : 0;
            
            this.log(`Total Tests: ${this.testResults.total}`, 'info');
            this.log(`Passed: ${this.testResults.passed} ✅`, 'success');
            this.log(`Failed: ${this.testResults.failed} ❌`, this.testResults.failed > 0 ? 'error' : 'info');
            this.log(`Pass Rate: ${passRate}%`, passRate >= 80 ? 'success' : 'warning');
            this.log(`Duration: ${this.testResults.duration.toFixed(2)}s`, 'info');
            
            this.log('\n' + '='.repeat(60), 'separator');
            
            // Migration readiness assessment
            if (this.testResults.failed === 0) {
                this.log('✅ MIGRATION READY: All tests passed!', 'pass');
                this.log('🚀 The API is fully functional and ready for production use.', 'success');
            } else if (passRate >= 80) {
                this.log('⚠️  MIGRATION CAUTION: Most tests passed but some issues detected.', 'warning');
                this.log('Review failed tests before migrating.', 'warning');
            } else {
                this.log('❌ NOT READY: Multiple test failures detected.', 'fail');
                this.log('Please fix API issues before attempting migration.', 'error');
            }
            
            this.log('='.repeat(60) + '\n', 'separator');
        }
        
        /**
         * Log message with formatting
         */
        log(message, type = 'info') {
            const styles = {
                header: 'font-weight: bold; font-size: 16px; color: #2563eb;',
                test: 'font-weight: bold; color: #7c3aed;',
                pass: 'color: #059669; font-weight: bold;',
                fail: 'color: #dc2626; font-weight: bold;',
                success: 'color: #059669;',
                error: 'color: #dc2626;',
                warning: 'color: #d97706;',
                info: 'color: #4b5563;',
                separator: 'color: #9ca3af;'
            };
            
            const style = styles[type] || styles.info;
            console.log(`%c${message}`, style);
        }
        
        /**
         * Export test results as JSON
         */
        exportResults() {
            const results = {
                ...this.testResults,
                api_url: this.baseUrl,
                generated_at: new Date().toISOString()
            };
            
            const dataStr = JSON.stringify(results, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
            
            const exportFileDefaultName = `mysql-api-test-results-${Date.now()}.json`;
            
            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();
            
            this.log('📥 Test results exported', 'success');
        }
    });

    // Auto-register for global access
    window.MySQLApiTester = ApiHandler;
}
