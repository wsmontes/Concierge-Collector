#!/bin/bash

# Script para abrir o index.html e monitorar comportamento
# Uso: ./test-index.sh

echo "🔍 Abrindo index.html e monitorando..."
echo ""
echo "📋 INSTRUÇÕES:"
echo "1. O browser vai abrir automaticamente"
echo "2. Abra o DevTools (F12 ou Cmd+Option+I)"
echo "3. Vá para a aba Console"
echo "4. Observe os logs:"
echo ""
echo "   ✅ CORRETO - Deve ver:"
echo "      🔐 AccessControl: Script loaded..."
echo "      🔓 AccessControl: initializeApp() called"
echo "      🔵 startApplication called, applicationStarted: false"
echo "      🚀 Starting Concierge Collector application..."
echo ""
echo "   ❌ LOOP - Se ver isso repetindo:"
echo "      🔵 startApplication called, applicationStarted: true"
echo "      ⚠️ Application already started, ignoring duplicate call"
echo ""
echo "5. Se houver loop, cole no console:"
echo ""
echo "   window.location.reload();"
echo ""
echo "6. Se continuar, use o debug script:"
echo "   Cole o conteúdo de debug-loop.js no console"
echo ""

# Abrir no browser padrão
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open index.html
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open index.html
else
    # Windows Git Bash
    start index.html
fi

echo ""
echo "✅ Browser aberto! Verifique o console."
echo ""
echo "💡 DICA: Se quiser ver mais detalhes, rode:"
echo "   python3 -m http.server 8000"
echo "   E acesse: http://localhost:8000"
