// Delete the problematic curation from IndexedDB
// Run this in browser console to stop infinite retry loop

(async function deleteProblemCuration() {
    const CURATION_ID = "curation_1770710922071_i7qlrmwxp";
    
    console.log(`🔍 Looking for curation ${CURATION_ID} in IndexedDB...`);
    
    try {
        const db = await window.databaseManager.getDatabase();
        const curation = await db.curations.get(CURATION_ID);
        
        if (curation) {
            console.log('✅ Found curation:', curation);
            console.log(`🗑️  Deleting from IndexedDB...`);
            
            await db.curations.delete(CURATION_ID);
            console.log('✅ Deleted from IndexedDB!');
            console.log('💡 Create a new test curation - this one was corrupted');
        } else {
            console.log('❌ Curation not found in IndexedDB');
            
            // List all curations
            const all = await db.curations.toArray();
            console.log(`\nTotal curations in IndexedDB: ${all.length}`);
            all.forEach(c => console.log(`  - ${c.curation_id} (sync: ${c.sync?.status})`));
        }
    } catch (error) {
        console.error('❌ Error:', error);
    }
})();
