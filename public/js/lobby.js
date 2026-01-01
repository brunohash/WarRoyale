const socket = io();
let currentLobby = null;
let currentUser = null;
let isAuthenticated = false;

// Exportar socket imediatamente para game.js
window.socket = socket;
console.log('🔌 Socket criado e exportado:', socket.id || 'aguardando conexão...');

// Função para autenticar
function authenticate() {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    
    if (!token || !user) {
        window.location.href = '/';
        return;
    }
    
    currentUser = user;
    const playerNameEl = document.getElementById('player-name');
    if (playerNameEl) {
        playerNameEl.textContent = user.username;
    }
    
    // Autenticar com o servidor
    console.log('🔐 Enviando autenticação...');
    socket.emit('authenticate', { token });
}

// Autenticar quando o socket conectar
socket.on('connect', () => {
    console.log('✅ Socket conectado, autenticando...');
    authenticate();
});

// Verificar autenticação ao carregar (fallback)
window.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    
    if (!token || !user) {
        window.location.href = '/';
        return;
    }
    
    // Se o socket já estiver conectado, autenticar imediatamente
    if (socket.connected) {
        authenticate();
    }
    
    // Mostrar opção de entrar em lobby
    if (document.getElementById('join-lobby')) {
        document.getElementById('join-lobby').style.display = 'block';
    }
});

socket.on('authenticated', (data) => {
    console.log('✅ Autenticado com sucesso:', data);
    isAuthenticated = true;
    window.isAuthenticated = true; // Exportar para outros scripts
});

socket.on('auth_error', (data) => {
    console.error('❌ Erro de autenticação:', data);
    isAuthenticated = false;
    window.isAuthenticated = false;
    alert('Erro de autenticação. Faça login novamente.');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
});

// Reautenticar se o socket reconectar
socket.on('reconnect', () => {
    console.log('🔄 Socket reconectado, reautenticando...');
    isAuthenticated = false;
    authenticate();
});

socket.on('lobby_created', (data) => {
    currentLobby = data.lobby;
    window.currentLobby = data.lobby; // Exportar para game.js
    // Atualizar modal do jogo se estiver aberto
    const menuModal = document.getElementById('game-menu-modal');
    if (menuModal && menuModal.style.display === 'block') {
        const lobbyIdEl = document.getElementById('lobby-id');
        const lobbyPlayersEl = document.getElementById('lobby-players');
        const totalPlayersEl = document.getElementById('total-players');
        const waitingMsg = document.getElementById('waiting-message');
        const lobbyInfoContainer = document.getElementById('lobby-info-container');
        
        if (lobbyIdEl) lobbyIdEl.textContent = data.lobbyId;
        if (lobbyPlayersEl) lobbyPlayersEl.textContent = `${data.lobby.players.length}/2`;
        if (totalPlayersEl) totalPlayersEl.textContent = data.lobby.players.length;
        if (lobbyInfoContainer) lobbyInfoContainer.style.display = 'block';
        
        if (waitingMsg) {
            if (data.lobby.players.length === 1) {
                waitingMsg.textContent = 'Aguardando outro jogador entrar na sala...';
            } else {
                waitingMsg.textContent = 'Ambos os jogadores estão na sala! Clique em "Estou Pronto!" quando estiver pronto.';
                waitingMsg.style.color = '#2ecc71';
            }
        }
    }
});

socket.on('player_joined', (data) => {
    currentLobby = data.lobby;
    window.currentLobby = data.lobby; // Exportar para game.js
    
    // Atualizar modal se estiver aberto
    const menuModal = document.getElementById('game-menu-modal');
    if (menuModal && menuModal.style.display === 'block') {
        const lobbyInfoContainer = document.getElementById('lobby-info-container');
        if (lobbyInfoContainer) {
            lobbyInfoContainer.style.display = 'block';
            const lobbyIdEl = document.getElementById('lobby-id');
            const lobbyPlayersEl = document.getElementById('lobby-players');
            const totalPlayersEl = document.getElementById('total-players');
            const waitingMsg = document.getElementById('waiting-message');
            
            if (lobbyIdEl) lobbyIdEl.textContent = data.lobby.id;
            if (lobbyPlayersEl) lobbyPlayersEl.textContent = `${data.lobby.players.length}/2`;
            if (totalPlayersEl) totalPlayersEl.textContent = data.lobby.players.length;
            
            if (waitingMsg) {
                if (data.lobby.players.length === 2) {
                    waitingMsg.textContent = 'Ambos os jogadores estão na sala! Clique em "Estou Pronto!" quando estiver pronto.';
                    waitingMsg.style.color = '#2ecc71';
                } else {
                    waitingMsg.textContent = 'Aguardando outro jogador entrar na sala...';
                    waitingMsg.style.color = '#e67e22';
                }
            }
        }
    }
    
    const lobbyPlayersEl = document.getElementById('lobby-players');
    const totalPlayersEl = document.getElementById('total-players');
    const waitingMsg = document.getElementById('waiting-message');
    
    if (lobbyPlayersEl) lobbyPlayersEl.textContent = `${data.lobby.players.length}/2`;
    if (totalPlayersEl) totalPlayersEl.textContent = data.lobby.players.length;
    
    if (waitingMsg) {
        if (data.lobby.players.length === 2) {
            waitingMsg.textContent = 'Ambos os jogadores estão na sala! Clique em "Estou Pronto!" quando estiver pronto.';
            waitingMsg.style.color = '#2ecc71';
        } else {
            waitingMsg.textContent = 'Aguardando outro jogador entrar na sala...';
            waitingMsg.style.color = '#e67e22';
        }
    }
});

socket.on('lobby_ready', (data) => {
    currentLobby = data.lobby;
    document.getElementById('lobby-players').textContent = `${data.lobby.players.length}/2`;
    
    const waitingMsg = document.getElementById('waiting-message');
    const startBtn = document.getElementById('start-game-btn');
    waitingMsg.style.display = 'none';
    startBtn.style.display = 'block';
});

socket.on('player_left', (data) => {
    if (currentLobby) {
        currentLobby.players = currentLobby.players.filter(p => p.username !== data.player.username);
        document.getElementById('lobby-players').textContent = `${currentLobby.players.length}/2`;
        document.getElementById('total-players').textContent = currentLobby.players.length;
        
        const waitingMsg = document.getElementById('waiting-message');
        const readyBtn = document.getElementById('ready-btn-lobby');
        
        // Se ainda tiver pelo menos 1 jogador
        if (currentLobby.players.length >= 1) {
            waitingMsg.textContent = 'Aguardando outro jogador entrar na sala...';
            waitingMsg.style.color = '#e67e22';
            if (readyBtn) {
                readyBtn.disabled = false;
                readyBtn.textContent = '✅ Estou Pronto!';
            }
        } else {
            waitingMsg.textContent = 'Nenhum jogador na sala.';
            if (readyBtn) {
                readyBtn.disabled = true;
            }
        }
    }
});

socket.on('game_started', (data) => {
    console.log('⚔️ Jogo iniciado (guerra começou)!', data);
    
    // Esconder informações do lobby (se o elemento existir)
    const lobbyInfo = document.getElementById('lobby-info');
    if (lobbyInfo) {
        lobbyInfo.style.display = 'none';
    }
    
    // O jogo será inicializado no game.js (já está sendo tratado no game.js via game_started event)
});

socket.on('error', (data) => {
    const message = data.message || 'Erro desconhecido';
    alert(message);
    console.error('❌ Erro:', message);
    
    // Se for erro de lobby, limpar input
    if (message.includes('Sala') || message.includes('lobby') || message.includes('ID')) {
        const input = document.getElementById('join-lobby-input');
        if (input) {
            input.value = '';
            input.focus();
        }
    }
});

function createLobby() {
    // Verificar se está autenticado
    if (!isAuthenticated && !window.isAuthenticated) {
        console.log('⏳ Aguardando autenticação...');
        // Tentar autenticar novamente
        authenticate();
        
        // Aguardar um pouco e tentar novamente
        setTimeout(() => {
            if (!isAuthenticated && !window.isAuthenticated) {
                alert('Erro de autenticação. Por favor, recarregue a página.');
                return;
            }
            socket.emit('create_lobby');
        }, 1000);
        return;
    }
    
    console.log('🎮 Criando lobby...');
    socket.emit('create_lobby');
}

// Função para entrar em lobby por ID
function joinLobby() {
    // Verificar se está autenticado
    if (!isAuthenticated && !window.isAuthenticated) {
        console.log('⏳ Aguardando autenticação...');
        authenticate();
        setTimeout(() => {
            if (!isAuthenticated && !window.isAuthenticated) {
                alert('Erro de autenticação. Por favor, recarregue a página.');
                return;
            }
            const input = document.getElementById('join-lobby-input');
            if (input && input.value) {
                socket.emit('join_lobby', { lobbyId: input.value });
            }
        }, 1000);
        return;
    }
    
    const input = document.getElementById('join-lobby-input');
    if (!input) {
        // Tentar encontrar o input no modal
        const modalInput = document.querySelector('#game-menu-modal input[type="text"]');
        if (modalInput) {
            const lobbyId = modalInput.value.trim();
            if (!lobbyId || lobbyId.length !== 4 || !/^\d{4}$/.test(lobbyId)) {
                alert('Por favor, digite um ID válido de 4 dígitos (ex: 1234)');
                return;
            }
            console.log('🚪 Entrando no lobby:', lobbyId);
            socket.emit('join_lobby', { lobbyId });
            return;
        }
        alert('Campo de entrada não encontrado');
        return;
    }
    
    const lobbyId = input.value.trim();
    if (!lobbyId || lobbyId.length !== 4 || !/^\d{4}$/.test(lobbyId)) {
        alert('Por favor, digite um ID válido de 4 dígitos (ex: 1234)');
        input.focus();
        return;
    }
    
    console.log('🚪 Entrando no lobby:', lobbyId);
    socket.emit('join_lobby', { lobbyId });
}

// Exportar função para uso global
window.joinLobby = joinLobby;

function startGame() {
    socket.emit('start_game');
}

// Função para marcar jogador como pronto
function setReady() {
    const readyBtn = document.getElementById('ready-btn-lobby');
    if (readyBtn.disabled) return;
    
    socket.emit('player_ready');
    readyBtn.disabled = true;
    readyBtn.textContent = '⏳ Aguardando outros jogadores...';
    readyBtn.style.background = '#95a5a6';
}

// Exportar função para uso no lobbyRoom.js
window.startGame = startGame;

// Copiar Lobby ID
function copyLobbyId() {
    const lobbyId = document.getElementById('lobby-id').textContent;
    const copyBtn = document.querySelector('button[onclick="copyLobbyId()"]');
    
    navigator.clipboard.writeText(lobbyId).then(() => {
        if (copyBtn) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✓ Copiado!';
            copyBtn.style.background = '#2ecc71';
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.background = '';
            }, 2000);
        } else {
            alert('Lobby ID copiado: ' + lobbyId);
        }
    }).catch(() => {
        // Fallback para navegadores antigos
        const textArea = document.createElement('textarea');
        textArea.value = lobbyId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('Lobby ID copiado: ' + lobbyId);
    });
}

// Exportar socket para uso no game.js
window.socket = socket;
window.currentUser = () => currentUser;

