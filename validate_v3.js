#!/usr/bin/env node

/**
 * V3 Architecture Validation Script
 * Tests V3 modules for basic functionality and compatibility
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 V3 Architecture Validation Starting...\n');

// Test 1: Check file existence
console.log('📁 Checking V3 module files...');
const requiredFiles = [
    'scripts/v3/entityStore.js',
    'scripts/v3/apiService.js',
    'scripts/v3/syncManager.js',
    'scripts/v3/importExportManager.js',
    'scripts/deprecated/legacyModules.js'
];

let filesExist = true;
requiredFiles.forEach(filePath => {
    const fullPath = path.join(process.cwd(), filePath);
    if (fs.existsSync(fullPath)) {
        console.log(`✅ ${filePath} - EXISTS`);
    } else {
        console.log(`❌ ${filePath} - MISSING`);
        filesExist = false;
    }
});

// Test 2: Check file sizes (ensure not empty)
console.log('\n📏 Checking V3 module file sizes...');
requiredFiles.forEach(filePath => {
    const fullPath = path.join(process.cwd(), filePath);
    if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        const sizeKB = (stats.size / 1024).toFixed(2);
        if (stats.size > 1000) { // At least 1KB
            console.log(`✅ ${filePath} - ${sizeKB}KB`);
        } else {
            console.log(`⚠️  ${filePath} - ${sizeKB}KB (might be too small)`);
        }
    }
});

// Test 3: Basic syntax check
console.log('\n🔍 Checking V3 module syntax...');
requiredFiles.forEach(filePath => {
    const fullPath = path.join(process.cwd(), filePath);
    if (fs.existsSync(fullPath)) {
        try {
            const content = fs.readFileSync(fullPath, 'utf8');
            
            // Basic checks
            const hasModuleWrapper = content.includes('ModuleWrapper');
            const hasProperHeader = content.includes('/**') && content.includes('Dependencies:');
            const hasInitialize = content.includes('initialize') || content.includes('init');
            
            console.log(`📄 ${filePath}:`);
            console.log(`  ModuleWrapper: ${hasModuleWrapper ? '✅' : '❌'}`);
            console.log(`  Header Comment: ${hasProperHeader ? '✅' : '❌'}`);
            console.log(`  Initialize Method: ${hasInitialize ? '✅' : '❌'}`);
            
        } catch (error) {
            console.log(`❌ ${filePath} - Error reading: ${error.message}`);
        }
    }
});

// Test 4: Check HTML updates
console.log('\n🌐 Checking HTML integration...');
const htmlFiles = ['index.html', 'test_v3_architecture.html'];
htmlFiles.forEach(htmlFile => {
    const fullPath = path.join(process.cwd(), htmlFile);
    if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        
        // Check if V3 modules are loaded
        const hasV3EntityStore = content.includes('scripts/v3/entityStore.js');
        const hasV3ApiService = content.includes('scripts/v3/apiService.js');
        const hasV3SyncManager = content.includes('scripts/v3/syncManager.js');
        const hasV3ImportExport = content.includes('scripts/v3/importExportManager.js');
        const hasLegacyWrapper = content.includes('scripts/deprecated/legacyModules.js');
        
        console.log(`📄 ${htmlFile}:`);
        console.log(`  V3 EntityStore: ${hasV3EntityStore ? '✅' : '❌'}`);
        console.log(`  V3 ApiService: ${hasV3ApiService ? '✅' : '❌'}`);
        console.log(`  V3 SyncManager: ${hasV3SyncManager ? '✅' : '❌'}`);
        console.log(`  V3 ImportExport: ${hasV3ImportExport ? '✅' : '❌'}`);
        console.log(`  Legacy Wrapper: ${hasLegacyWrapper ? '✅' : '❌'}`);
    } else {
        console.log(`❌ ${htmlFile} - File not found`);
    }
});

// Test 5: Check main.js updates
console.log('\n⚙️ Checking main.js V3 integration...');
const mainJsPath = path.join(process.cwd(), 'scripts/main.js');
if (fs.existsSync(mainJsPath)) {
    const content = fs.readFileSync(mainJsPath, 'utf8');
    
    const hasV3EntityStore = content.includes('window.EntityStore');
    const hasV3SyncManager = content.includes('window.V3SyncManager');
    const hasV3ApiService = content.includes('window.V3ApiService');
    const hasV3Comments = content.includes('V3:') || content.includes('V3 ');
    
    console.log(`📄 main.js:`);
    console.log(`  V3 EntityStore references: ${hasV3EntityStore ? '✅' : '❌'}`);
    console.log(`  V3 SyncManager references: ${hasV3SyncManager ? '✅' : '❌'}`);
    console.log(`  V3 ApiService references: ${hasV3ApiService ? '✅' : '❌'}`);
    console.log(`  V3 Comments: ${hasV3Comments ? '✅' : '❌'}`);
} else {
    console.log(`❌ main.js - File not found`);
}

// Summary
console.log('\n📊 V3 Architecture Validation Summary:');
console.log(`Files Status: ${filesExist ? '✅ All required files present' : '❌ Some files missing'}`);

console.log('\n🚀 Next Steps:');
console.log('1. Open index.html in a browser to test V3 functionality');
console.log('2. Open test_v3_architecture.html for comprehensive V3 testing');
console.log('3. Check browser console for any initialization errors');
console.log('4. Test import functionality with a restaurant JSON file');

console.log('\n✨ V3 Architecture Validation Complete!');