#!/bin/bash

# Script para iniciar o servidor com túnel automático
# Funciona com ngrok ou localhost.run

echo "🎮 War Royale - Iniciando com Túnel"
echo "===================================="
echo ""

# Verificar se ngrok está instalado
if command -v ngrok &> /dev/null; then
    echo "✅ ngrok encontrado!"
    echo ""
    echo "Iniciando servidor na porta 3000..."
    npm start &
    SERVER_PID=$!
    
    sleep 2
    
    echo ""
    echo "🌐 Iniciando túnel ngrok..."
    echo "===================================="
    ngrok http 3000
    
    # Quando ngrok fechar, matar o servidor também
    kill $SERVER_PID 2>/dev/null
    exit 0
fi

# Se ngrok não estiver instalado, tentar localhost.run
echo "⚠️  ngrok não encontrado. Tentando localhost.run..."
echo ""
echo "Iniciando servidor na porta 3000..."
npm start &
SERVER_PID=$!

sleep 2

echo ""
echo "🌐 Iniciando túnel localhost.run..."
echo "===================================="
echo "📋 Copie a URL que aparecer abaixo e compartilhe com seus amigos!"
echo ""

ssh -R 80:localhost:3000 nokey@localhost.run

# Quando ssh fechar, matar o servidor também
kill $SERVER_PID 2>/dev/null
exit 0

