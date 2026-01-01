const lobbyCanvas = document.getElementById('game-canvas');
const lobbyCtx = lobbyCanvas.getContext('2d');

let lobbyPlayers = new Map(); // Map<userId, playerData>
let myPlayer = null;
let lobbyKeys = {};
let isInLobby = false;

// Cores diferentes para cada jogador
const playerColors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];

// Inicializar sala de lobby
window.initLobbyRoom = function(lobbyData, currentUser) {
    isInLobby = true;
    
    // Adicionar todos os jogadores do lobby (sem limpar se já existirem)
    lobbyData.players.forEach((player, index) => {
        // Só adicionar se não existir
        if (!lobbyPlayers.has(player.userId)) {
            const playerData = {
                id: player.userId,
                username: player.username,
                x: 200 + (lobbyPlayers.size * 150), // Posição inicial distribuída
                y: 300,
                color: playerColors[lobbyPlayers.size % playerColors.length],
                direction: 'down' // down, up, left, right
            };
            
            lobbyPlayers.set(player.userId, playerData);
            
            // Se for o jogador atual
            if (player.userId === currentUser.id) {
                myPlayer = playerData;
            }
        } else if (player.userId === currentUser.id) {
            // Atualizar referência do meu jogador
            myPlayer = lobbyPlayers.get(player.userId);
        }
    });
    
    // Iniciar loop de renderização se ainda não estiver rodando
    if (!window.lobbyRoomLoopRunning) {
        window.lobbyRoomLoopRunning = true;
        lobbyRoomLoop();
    }
};

// Controles do lobby
document.addEventListener('keydown', (e) => {
    if (!isInLobby || !myPlayer) return;
    
    const key = e.key.toLowerCase();
    lobbyKeys[key] = true;
    
    // Prevenir scroll com setas
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        e.preventDefault();
    }
});

document.addEventListener('keyup', (e) => {
    if (!isInLobby || !myPlayer) return;
    
    const key = e.key.toLowerCase();
    lobbyKeys[key] = false;
});

function updateLobbyPlayer() {
    if (!myPlayer || !isInLobby) return;
    
    const speed = 2;
    let moved = false;
    let newDirection = myPlayer.direction;
    
    // Movimento WASD ou setas
    if (lobbyKeys['w'] || lobbyKeys['arrowup']) {
        myPlayer.y = Math.max(50, myPlayer.y - speed);
        moved = true;
        newDirection = 'up';
    }
    if (lobbyKeys['s'] || lobbyKeys['arrowdown']) {
        myPlayer.y = Math.min(lobbyCanvas.height - 50, myPlayer.y + speed);
        moved = true;
        newDirection = 'down';
    }
    if (lobbyKeys['a'] || lobbyKeys['arrowleft']) {
        myPlayer.x = Math.max(50, myPlayer.x - speed);
        moved = true;
        newDirection = 'left';
    }
    if (lobbyKeys['d'] || lobbyKeys['arrowright']) {
        myPlayer.x = Math.min(lobbyCanvas.width - 50, myPlayer.x + speed);
        moved = true;
        newDirection = 'right';
    }
    
    if (moved) {
        myPlayer.direction = newDirection;
        
        // Enviar movimento para o servidor
        if (window.socket) {
            window.socket.emit('lobby_player_move', {
                position: { x: myPlayer.x, y: myPlayer.y },
                direction: myPlayer.direction
            });
        }
    }
}

function renderLobbyRoom() {
    if (!isInLobby) return;
    
    // Limpar canvas
    lobbyCtx.fillStyle = '#34495e';
    lobbyCtx.fillRect(0, 0, lobbyCanvas.width, lobbyCanvas.height);
    
    // Desenhar chão (padrão de tiles)
    drawFloor();
    
    // Desenhar bordas da sala
    lobbyCtx.strokeStyle = '#2c3e50';
    lobbyCtx.lineWidth = 4;
    lobbyCtx.strokeRect(10, 10, lobbyCanvas.width - 20, lobbyCanvas.height - 20);
    
    // Desenhar título da sala
    lobbyCtx.fillStyle = 'white';
    lobbyCtx.font = 'bold 20px Arial';
    lobbyCtx.textAlign = 'center';
    lobbyCtx.fillText('Sala do Lobby', lobbyCanvas.width / 2, 30);
    
    // Desenhar todos os jogadores
    lobbyPlayers.forEach((playerData) => {
        drawPlayer(playerData);
    });
    
    // Desenhar informações no canto
    lobbyCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    lobbyCtx.fillRect(10, lobbyCanvas.height - 80, 200, 70);
    
    lobbyCtx.fillStyle = 'white';
    lobbyCtx.font = '12px Arial';
    lobbyCtx.textAlign = 'left';
    lobbyCtx.fillText(`Jogadores: ${lobbyPlayers.size}`, 20, lobbyCanvas.height - 60);
    lobbyCtx.fillText('Use WASD ou Setas para mover', 20, lobbyCanvas.height - 45);
    lobbyCtx.fillText('Pressione ESPAÇO para iniciar', 20, lobbyCanvas.height - 30);
}

function drawFloor() {
    const tileSize = 40;
    lobbyCtx.fillStyle = '#2c3e50';
    
    for (let x = 0; x < lobbyCanvas.width; x += tileSize) {
        for (let y = 0; y < lobbyCanvas.height; y += tileSize) {
            if ((x / tileSize + y / tileSize) % 2 === 0) {
                lobbyCtx.fillRect(x, y, tileSize, tileSize);
            }
        }
    }
}

function drawPlayer(playerData) {
    const { x, y, color, username, direction } = playerData;
    
    // Sombra do personagem
    lobbyCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    lobbyCtx.beginPath();
    lobbyCtx.ellipse(x, y + 25, 15, 5, 0, 0, Math.PI * 2);
    lobbyCtx.fill();
    
    // Corpo do personagem (círculo)
    lobbyCtx.fillStyle = color;
    lobbyCtx.beginPath();
    lobbyCtx.arc(x, y, 20, 0, Math.PI * 2);
    lobbyCtx.fill();
    
    // Borda do personagem
    lobbyCtx.strokeStyle = '#2c3e50';
    lobbyCtx.lineWidth = 2;
    lobbyCtx.stroke();
    
    // Olhos (baseado na direção)
    lobbyCtx.fillStyle = 'white';
    if (direction === 'left') {
        lobbyCtx.fillRect(x - 8, y - 5, 3, 3);
        lobbyCtx.fillRect(x - 8, y + 2, 3, 3);
    } else if (direction === 'right') {
        lobbyCtx.fillRect(x + 5, y - 5, 3, 3);
        lobbyCtx.fillRect(x + 5, y + 2, 3, 3);
    } else {
        lobbyCtx.fillRect(x - 5, y - 5, 3, 3);
        lobbyCtx.fillRect(x + 2, y - 5, 3, 3);
    }
    
    // Nome do jogador
    lobbyCtx.fillStyle = 'white';
    lobbyCtx.font = 'bold 12px Arial';
    lobbyCtx.textAlign = 'center';
    lobbyCtx.fillText(username, x, y - 35);
    
    // Indicador se é você
    if (playerData.id === myPlayer?.id) {
        lobbyCtx.strokeStyle = '#f39c12';
        lobbyCtx.lineWidth = 3;
        lobbyCtx.beginPath();
        lobbyCtx.arc(x, y, 25, 0, Math.PI * 2);
        lobbyCtx.stroke();
    }
}

function lobbyRoomLoop() {
    if (isInLobby) {
        updateLobbyPlayer();
        renderLobbyRoom();
        requestAnimationFrame(lobbyRoomLoop);
    }
}

// Parar a sala do lobby
window.stopLobbyRoom = function() {
    isInLobby = false;
    window.lobbyRoomLoopRunning = false;
};

// Escutar movimentos de outros jogadores no lobby
if (window.socket) {
    setupLobbySocketListeners();
} else {
    const checkSocket = setInterval(() => {
        if (window.socket) {
            setupLobbySocketListeners();
            clearInterval(checkSocket);
        }
    }, 100);
}

function setupLobbySocketListeners() {
    if (window.socket && !window.lobbySocketListenersSetup) {
        window.socket.on('lobby_player_moved', (data) => {
            const otherPlayer = lobbyPlayers.get(data.playerId);
            if (otherPlayer && otherPlayer.id !== myPlayer?.id) {
                otherPlayer.x = data.position.x;
                otherPlayer.y = data.position.y;
                otherPlayer.direction = data.direction;
            }
        });
        
        window.socket.on('lobby_player_joined', (data) => {
            // Não adicionar se já existe (pode ser o próprio jogador)
            if (!lobbyPlayers.has(data.player.userId)) {
                const playerData = {
                    id: data.player.userId,
                    username: data.player.username,
                    x: 200 + (lobbyPlayers.size * 150),
                    y: 300,
                    color: playerColors[lobbyPlayers.size % playerColors.length],
                    direction: 'down'
                };
                lobbyPlayers.set(data.player.userId, playerData);
            }
        });
        
        window.socket.on('lobby_player_left', (data) => {
            lobbyPlayers.delete(data.playerId);
        });
        
        window.lobbySocketListenersSetup = true;
    }
}

// Permitir iniciar jogo com espaço quando estiver no lobby
document.addEventListener('keydown', (e) => {
    if (e.key === ' ' && isInLobby && myPlayer) {
        e.preventDefault();
        if (window.startGame) {
            window.startGame();
        }
    }
});

