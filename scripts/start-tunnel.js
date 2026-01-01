#!/usr/bin/env node

/**
 * Script para iniciar servidor com túnel automático
 * Tenta usar ngrok, se não encontrar, usa localhost.run
 */

const { spawn } = require('child_process');
const http = require('http');

console.log('🎮 War Royale - Iniciando com Túnel');
console.log('====================================\n');

// Verificar se ngrok está disponível
function checkNgrok() {
  return new Promise((resolve) => {
    const ngrok = spawn('ngrok', ['version'], { stdio: 'pipe' });
    ngrok.on('close', (code) => {
      resolve(code === 0);
    });
    ngrok.on('error', () => {
      resolve(false);
    });
  });
}

// Iniciar servidor
function startServer() {
  console.log('📦 Iniciando servidor na porta 3000...\n');
  const server = spawn('npm', ['start'], {
    stdio: 'inherit',
    shell: true
  });

  // Aguardar servidor iniciar
  return new Promise((resolve) => {
    const checkServer = setInterval(() => {
      http.get('http://localhost:3000', (res) => {
        clearInterval(checkServer);
        console.log('✅ Servidor iniciado!\n');
        resolve(server);
      }).on('error', () => {
        // Servidor ainda não está pronto
      });
    }, 500);

    // Timeout de 10 segundos
    setTimeout(() => {
      clearInterval(checkServer);
      resolve(server);
    }, 10000);
  });
}

// Iniciar ngrok
function startNgrok(serverProcess) {
  console.log('🌐 Iniciando túnel ngrok...');
  console.log('====================================\n');
  console.log('📋 Copie a URL que aparecer abaixo e compartilhe!\n');

  const ngrok = spawn('ngrok', ['http', '3000'], {
    stdio: 'inherit',
    shell: true
  });

  ngrok.on('close', () => {
    console.log('\n\n⚠️  Túnel fechado. Encerrando servidor...');
    serverProcess.kill();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\n\n⚠️  Encerrando...');
    ngrok.kill();
    serverProcess.kill();
    process.exit(0);
  });
}

// Iniciar localhost.run (fallback)
function startLocalhostRun(serverProcess) {
  console.log('🌐 Iniciando túnel localhost.run...');
  console.log('====================================\n');
  console.log('📋 Copie a URL que aparecer abaixo e compartilhe!\n');

  const ssh = spawn('ssh', ['-R', '80:localhost:3000', 'nokey@localhost.run'], {
    stdio: 'inherit',
    shell: true
  });

  ssh.on('close', () => {
    console.log('\n\n⚠️  Túnel fechado. Encerrando servidor...');
    serverProcess.kill();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\n\n⚠️  Encerrando...');
    ssh.kill();
    serverProcess.kill();
    process.exit(0);
  });
}

// Main
(async () => {
  const hasNgrok = await checkNgrok();

  if (hasNgrok) {
    console.log('✅ ngrok encontrado!\n');
    const server = await startServer();
    setTimeout(() => startNgrok(server), 2000);
  } else {
    console.log('⚠️  ngrok não encontrado.');
    console.log('💡 Tentando localhost.run...\n');
    console.log('📥 Para usar ngrok, instale: https://ngrok.com/download\n');
    
    const server = await startServer();
    setTimeout(() => startLocalhostRun(server), 2000);
  }
})();

