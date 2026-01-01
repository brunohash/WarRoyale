const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const authRoutes = require('./routes/auth');
const gameServer = require('./game/gameServer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
// Servir sprites da pasta raiz
app.use('/sprites', express.static(path.join(__dirname, 'sprites')));

// Rotas
app.use('/api/auth', authRoutes);

// Servir páginas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// Inicializar servidor de jogo
console.log('🔧 Inicializando gameServer...');
try {
  gameServer.initialize(io);
  console.log('✅ GameServer inicializado com sucesso');
} catch (error) {
  console.error('❌ Erro ao inicializar gameServer:', error);
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const os = require('os');

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

console.log('🔧 Tentando iniciar servidor na porta', PORT);
server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     🎮 War Royale - Servidor Online    ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log(`📍 Local:     http://localhost:${PORT}`);
  console.log(`🌐 Rede:      http://${localIP}:${PORT}`);
  console.log(`\n💡 Para jogar com amigos na mesma rede:`);
  console.log(`   Compartilhe: http://${localIP}:${PORT}\n`);
});

server.on('error', (error) => {
  console.error('❌ Erro no servidor:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`⚠️ Porta ${PORT} já está em uso!`);
    console.error('   Tente fechar outros processos ou usar outra porta.');
  }
});

