// Check if TESTE_DB exists in IndexedDB
// Run this in the browser console

(async function checkIndexedDB() {
    try {
        // Open IndexedDB
        const request = indexedDB.open('lotier-collector', 91);
        
        request.onsuccess = async function(event) {
            const db = event.target.result;
            const transaction = db.transaction(['entities'], 'readonly');
            const store = transaction.objectStore('entities');
            const getAllRequest = store.getAll();
            
            getAllRequest.onsuccess = function() {
                const entities = getAllRequest.result;
                const testeDB = entities.find(e => e.name && e.name.includes('TESTE'));
                
                if (testeDB) {
                    console.log('✅ TESTE_DB encontrado no IndexedDB local:');
                    console.log('  entity_id:', testeDB.entity_id);
                    console.log('  name:', testeDB.name);
                    console.log('  sync_status:', testeDB.sync_status);
                    console.log('  created_at:', testeDB.created_at);
                    console.log('\n📋 Entidade completa:', testeDB);
                } else {
                    console.log('❌ TESTE_DB não encontrado no IndexedDB local');
                    console.log('\n🔍 Total de entidades:', entities.length);
                    console.log('🔍 Últimas 5 entidades:', entities.slice(-5).map(e => e.name || e.entity_id));
                }
            };
        };
        
        request.onerror = function() {
            console.error('❌ Erro ao abrir IndexedDB:', request.error);
        };
    } catch (error) {
        console.error('❌ Erro:', error);
    }
})();
