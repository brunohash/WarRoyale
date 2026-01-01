const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Constantes compartilhadas para rio e pontes (usadas em renderização e detecção)
const RIVER_CENTER_X = canvas.width / 2; // 500
const RIVER_WIDTH = 80;
const RIVER_LEFT = RIVER_CENTER_X - RIVER_WIDTH / 2; // 460
const RIVER_RIGHT = RIVER_CENTER_X + RIVER_WIDTH / 2; // 540

const BRIDGE_WIDTH = 120;
const BRIDGE_HEIGHT = 15;
const BRIDGE_LEFT = RIVER_CENTER_X - BRIDGE_WIDTH / 2; // 440
const BRIDGE_RIGHT = RIVER_CENTER_X + BRIDGE_WIDTH / 2; // 560

const TOP_BRIDGE_Y = 200;
const BOTTOM_BRIDGE_Y = canvas.height - 200 - BRIDGE_HEIGHT; // 485

// Área de detecção das pontes (com margem para movimento suave)
// Ajustar margens para corresponder exatamente à ponte visual
const BRIDGE_DETECTION_MARGIN = 15; // Margem maior para movimento suave
const TOP_BRIDGE_TOP = TOP_BRIDGE_Y - BRIDGE_DETECTION_MARGIN; // 185
const TOP_BRIDGE_BOTTOM = TOP_BRIDGE_Y + BRIDGE_HEIGHT + BRIDGE_DETECTION_MARGIN; // 230
// Para ponte inferior, aumentar margem superior para incluir área antes da ponte visual
const BOTTOM_BRIDGE_TOP = BOTTOM_BRIDGE_Y - 35; // 450 (margem maior acima para incluir área antes da ponte)
const BOTTOM_BRIDGE_BOTTOM = BOTTOM_BRIDGE_Y + BRIDGE_HEIGHT + BRIDGE_DETECTION_MARGIN; // 515

let gameState = null;
let player = null;
let keys = {};
let gameStarted = false;
let attacks = []; // Animações de ataque locais
let lastAttackTime = 0;
let lastPlayerDirection = { x: 1, y: 0 }; // Última direção do movimento (padrão: direita)
let damageTexts = []; // Textos de dano flutuantes
let playerLastPosition = { x: 0, y: 0 }; // Última posição do jogador para detectar movimento
let playerLastMoveTime = Date.now(); // Timestamp do último movimento
let playerLastAttackTime = 0; // Timestamp do último ataque do jogador (para animação)

// Imagem de fundo do campo de batalha
let battlefieldBackground = null;
const backgroundImage = new Image();
backgroundImage.onload = () => {
    battlefieldBackground = backgroundImage;
    console.log('✅ Imagem de fundo do campo de batalha carregada!');
};
backgroundImage.onerror = () => {
    console.warn('⚠️ Erro ao carregar imagem de fundo, usando cor sólida');
};
backgroundImage.src = 'https://img.freepik.com/vetores-gratis/vista-aerea-de-jardim-fundo_1308-28256.jpg?semt=ais_hybrid&w=740&q=80';

// Imagem da torre
let towerImage = null;
const towerSprite = new Image();
towerSprite.crossOrigin = 'anonymous'; // Permitir CORS
towerSprite.onload = () => {
    towerImage = towerSprite;
    console.log('✅ Imagem da torre carregada!');
};
towerSprite.onerror = () => {
    console.warn('⚠️ Erro ao carregar imagem da torre, usando retângulo');
};
towerSprite.src = 'https://static.vecteezy.com/system/resources/thumbnails/047/655/262/small/castle-tower-isolated-on-transparent-background-free-png.png';


// Controles Touch/D-Pad
let dpadActive = {};

// Rastreamento de posição do mouse para preview de tropas
let mousePosition = { x: 0, y: 0 };
let mouseX = 0;
let mouseY = 0;

// Inicializar canvas com tela de espera
initWaitingScreen();

// Rastrear posição do mouse no canvas
// Função para atualizar posição do mouse/touch
function updateMousePosition(event) {
    const coords = getCanvasCoordinates(event);
    mouseX = coords.x;
    mouseY = coords.y;
    mousePosition = { x: mouseX, y: mouseY };
    
    // Se estiver arrastando, mudar cursor
    if (isDragging && selectedTroopId && player) {
        const validX = player.team === 'left' ? (mouseX >= 0 && mouseX <= canvas.width / 2) : (mouseX >= canvas.width / 2 && mouseX <= canvas.width);
        const validY = mouseY >= 0 && mouseY <= canvas.height;
        canvas.style.cursor = (validX && validY) ? 'grabbing' : 'not-allowed';
    }
}

canvas.addEventListener('mousemove', updateMousePosition);
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault(); // Prevenir scroll
    updateMousePosition(e);
}, { passive: false });

// Cancelar drag se soltar fora do canvas
document.addEventListener('mouseup', (e) => {
    if (isDragging && selectedTroopId) {
        // Verificar se soltou dentro do canvas
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Se soltou fora do canvas, cancelar
        if (x < 0 || x > canvas.width || y < 0 || y > canvas.height) {
            cancelDrag();
        }
    }
});

// Controles
document.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    
        // Upgrade com E
        if (e.key.toLowerCase() === 'e') {
            e.preventDefault();
            if (window.socket && window.socket.connected && player) {
                window.socket.emit('upgrade_tower');
                console.log('🔧 Tentando fazer upgrade na torre...');
            }
        }
        
        // Spawnar inimigos com I
        if (e.key.toLowerCase() === 'i') {
            e.preventDefault();
            if (window.socket && window.socket.connected) {
                window.socket.emit('spawn_enemy_minions');
                console.log('👾 Spawnando inimigos das torres inimigas...');
            } else {
                console.log('❌ Socket não conectado ou não disponível');
            }
        }
        
        // Flecha especial com Q (50 moedas)
        if (e.key.toLowerCase() === 'q') {
            e.preventDefault();
            console.log('🔍 Tecla Q pressionada!', {
                socket: !!window.socket,
                connected: window.socket?.connected,
                player: !!player,
                coins: player?.coins
            });
            
            if (window.socket && window.socket.connected) {
                if (player && player.coins >= 50) {
                    // Determinar direção da flecha (última direção do movimento)
                    let arrowDirection = { x: 1, y: 0 }; // Padrão: direita
                    if (lastPlayerDirection && (lastPlayerDirection.x !== 0 || lastPlayerDirection.y !== 0)) {
                        arrowDirection = lastPlayerDirection;
                    }
                    
                    // Normalizar direção
                    const dirLength = Math.hypot(arrowDirection.x, arrowDirection.y);
                    const normalizedDir = dirLength > 0 
                        ? { x: arrowDirection.x / dirLength, y: arrowDirection.y / dirLength }
                        : { x: 1, y: 0 };
                    
                    // Criar flecha local temporária para feedback visual imediato
                    const now = Date.now();
                    if (!gameState.projectiles) gameState.projectiles = [];
                    const localArrow = {
                        id: `arrow_local_${now}`,
                        x: player.position.x,
                        y: player.position.y,
                        startX: player.position.x,
                        startY: player.position.y,
                        directionX: normalizedDir.x,
                        directionY: normalizedDir.y,
                        team: player.team,
                        speed: 15,
                        damage: 300,
                        radius: 80,
                        timestamp: now,
                        type: 'arrow_special',
                        maxDistance: 2000,
                        isLocal: true // Marcar como local para remover quando receber do servidor
                    };
                    gameState.projectiles.push(localArrow);
                    console.log('🏹 Flecha local criada para feedback visual:', localArrow);
                    
                    const arrowData = {
                        position: { x: player.position.x, y: player.position.y },
                        direction: arrowDirection,
                        timestamp: now
                    };
                    console.log('🏹🏹🏹 ENVIANDO arrow_special_attack para servidor:', arrowData);
                    window.socket.emit('arrow_special_attack', arrowData);
                    console.log('🏹 Flecha especial ativada!', {
                        position: { x: player.position.x, y: player.position.y },
                        direction: arrowDirection
                    });
                } else if (!player) {
                    console.log('❌ Player não está definido ainda');
                } else {
                    console.log(`❌ Moedas insuficientes para flecha especial (${player.coins}/50)`);
                    alert(`Moedas insuficientes! Você precisa de 50 moedas (você tem ${player.coins})`);
                }
            } else {
                console.log('❌ Socket não conectado');
            }
        }
        
        // Super golpe com R
        if (e.key.toLowerCase() === 'r') {
            e.preventDefault();
            if (window.socket && window.socket.connected && player) {
                if (player.coins >= 3) {
                    const now = Date.now();
                    
                    // Criar animação local imediatamente (super golpe)
                    let attackDirection = { x: 1, y: 0 }; // Padrão: direita
                    if (lastPlayerDirection.x !== 0 || lastPlayerDirection.y !== 0) {
                        attackDirection = lastPlayerDirection;
                    }
                    
                    const localAttack = {
                        x: player.position.x,
                        y: player.position.y,
                        timestamp: now,
                        team: player.team,
                        playerId: player.id,
                        radius: 100,
                        isSpecial: true,
                        direction: attackDirection
                    };
                    attacks.push(localAttack);
                    
                    window.socket.emit('special_attack', {
                        position: { x: player.position.x, y: player.position.y },
                        timestamp: now,
                        isSpecialAttack: true
                    });
                    console.log('💥 Super golpe ativado!');
                } else {
                    console.log(`❌ Moedas insuficientes para super golpe (${player.coins}/3)`);
                }
            }
        }
        
        // HACK: Gerar moeda com Z
        if (e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (window.socket && window.socket.connected && player) {
                window.socket.emit('hack_add_coin');
                console.log('💰 HACK: Moeda adicionada!');
            }
        }
    
    // Ataque com espaço
    if (e.key === ' ') {
        e.preventDefault();
        const now = Date.now();
        
        // Verificar cooldown local (feedback imediato)
        if (now - lastAttackTime < 500) return;
        lastAttackTime = now;
        playerLastAttackTime = now; // Marcar tempo do ataque para animação
        
        if (player && window.socket) {
            // Calcular direção do ataque baseada no movimento
            let attackDirection = { x: 1, y: 0 }; // Padrão: direita
            if (lastPlayerDirection.x !== 0 || lastPlayerDirection.y !== 0) {
                attackDirection = lastPlayerDirection;
            }
            
            // Criar animação local imediatamente (espadada)
            const localAttack = {
                x: player.position.x,
                y: player.position.y,
                timestamp: now,
                team: player.team,
                playerId: player.id,
                radius: 50,
                direction: attackDirection // Adicionar direção ao ataque
            };
            
            console.log(`🗡️ Ataque local em (${localAttack.x}, ${localAttack.y})`);
            attacks.push(localAttack);
            
            if (!window.socket) {
                console.error('❌ Socket não existe!');
                return;
            }
            
            console.log(`🔍 Estado do socket:`, {
                connected: window.socket.connected,
                id: window.socket.id,
                disconnected: window.socket.disconnected
            });
            
            if (!window.socket.connected) {
                console.error('❌ Socket não está conectado! Estado:', window.socket.connected);
                console.error('   Tentando reconectar...');
                return;
            }
            
            console.log(`📤 Enviando ataque para servidor...`);
            console.log(`   Socket ID: ${window.socket.id}`);
            console.log(`   Posição: (${player.position.x}, ${player.position.y})`);
            
            try {
                window.socket.emit('player_attack', {
                    position: { x: player.position.x, y: player.position.y },
                    timestamp: now
                }, (ack) => {
                    if (ack) {
                        console.log('✅ Servidor confirmou:', ack);
                    }
                });
                console.log(`✅ Ataque emitido (sem erro de sintaxe)`);
            } catch (error) {
                console.error('❌ Erro ao enviar ataque:', error);
            }
        }
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
});

// Tela de espera
// Função para comprar tropa (chamada do modal)
function buyTroop(type, quantity) {
    if (!window.socket || !window.socket.connected) {
        console.log('❌ Socket não conectado');
        return;
    }
    
    if (!player) {
        console.log('❌ Jogador não encontrado');
        return;
    }
    
    const costPerTroop = 10;
    const totalCost = costPerTroop * quantity;
    
    if (player.coins < totalCost) {
        alert(`Moedas insuficientes! Você precisa de ${totalCost} moedas.`);
        return;
    }
    
    console.log(`🛒 Comprando ${quantity} ${type === 'ranged' ? 'arqueiros' : 'guerreiros'} por ${totalCost} moedas...`);
    window.socket.emit('buy_troops', { type, quantity });
    updateInventory();
}

// Abrir modal de loja
function openShopModal() {
    const modal = document.getElementById('shop-modal');
    if (modal) {
        modal.style.display = 'block';
        // Não atualizar inventário aqui - ele está no sidebar agora
    }
}

// Fechar modal de loja
function closeShopModal() {
    const modal = document.getElementById('shop-modal');
    if (modal) {
        modal.style.display = 'none';
        console.log('✅ Modal fechado');
    }
}

// Fechar modal ao clicar fora dele
document.addEventListener('click', (e) => {
    const modal = document.getElementById('shop-modal');
    if (modal && modal.style.display === 'block') {
        const modalContent = modal.querySelector('.shop-modal-content');
        // Fechar se clicou fora do conteúdo do modal
        if (modalContent && !modalContent.contains(e.target)) {
            // Não fechar se clicou em botão de abrir loja
            if (!e.target.closest('button[onclick*="openShopModal"]') && 
                !e.target.closest('.shop-modal-content')) {
                closeShopModal();
            }
        }
    }
});

// Atualizar inventário (sidebar ao lado do canvas)
function updateInventory() {
    const inventoryGrid = document.getElementById('troop-inventory');
    const sidebar = document.getElementById('troop-inventory-sidebar');
    
    if (!player || !player.troops) {
        if (inventoryGrid) {
            inventoryGrid.innerHTML = '<p style="color: #95a5a6; text-align: center; padding: 20px; font-size: 12px;">Nenhuma tropa comprada ainda</p>';
        }
        return;
    }
    
    if (!inventoryGrid) return;
    
    inventoryGrid.innerHTML = '';
    
    const unplacedTroops = player.troops.filter(t => !t.placed);
    const placedTroops = player.troops.filter(t => t.placed);
    
    if (unplacedTroops.length === 0 && placedTroops.length === 0) {
        inventoryGrid.innerHTML = '<p style="color: #95a5a6; text-align: center; padding: 20px; font-size: 12px;">Nenhuma tropa comprada ainda</p>';
        return;
    }
    
    // Mostrar tropas não posicionadas primeiro
    unplacedTroops.forEach(troop => {
        const item = document.createElement('div');
        item.className = 'inventory-item-sidebar';
        item.dataset.troopId = troop.id;
        item.style.cursor = 'grab';
        item.title = 'Clique e arraste para o campo de batalha';
        
        item.innerHTML = `
            <div class="troop-icon-sidebar">${troop.type === 'ranged' ? '🏹' : '⚔️'}</div>
            <div class="troop-type-sidebar">${troop.type === 'ranged' ? 'Arqueiro' : 'Guerreiro'}</div>
            <div style="font-size: 9px; color: #f1c40f; margin-top: 3px;">Clique para arrastar</div>
        `;
        
        item.addEventListener('click', () => {
            selectTroopForPlacement(troop.id);
        });
        
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectTroopForPlacement(troop.id);
        });
        
        // Suporte para touch no mobile
        item.addEventListener('touchstart', (e) => {
            e.preventDefault();
            selectTroopForPlacement(troop.id);
        }, { passive: false });
        
        inventoryGrid.appendChild(item);
    });
    
    // Mostrar tropas já posicionadas (mais opacas)
    placedTroops.forEach(troop => {
        const item = document.createElement('div');
        item.className = 'inventory-item-sidebar placed';
        item.dataset.troopId = troop.id;
        item.style.cursor = 'not-allowed';
        item.title = 'Tropa já posicionada';
        
        item.innerHTML = `
            <div class="troop-icon-sidebar">${troop.type === 'ranged' ? '🏹' : '⚔️'}</div>
            <div class="troop-type-sidebar">${troop.type === 'ranged' ? 'Arq' : 'Guer'}</div>
            <div style="font-size: 8px; color: #2ecc71; margin-top: 2px;">✓</div>
        `;
        
        inventoryGrid.appendChild(item);
    });
    
    // Mostrar sidebar se houver tropas
    if (sidebar) {
        sidebar.style.display = 'block';
    }
}

// Sistema de drag and drop para tropas
let selectedTroopId = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let placingTroop = false; // Prevenir múltiplos cliques rápidos

// Função para cancelar o drag and drop
function cancelDrag() {
    selectedTroopId = null;
    isDragging = false;
    dragStartX = 0;
    dragStartY = 0;
    placingTroop = false;
}

// Função helper para calcular coordenadas do canvas considerando o scale
function getCanvasCoordinates(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    let clientX, clientY;
    
    // Suportar tanto mouse quanto touch events
    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) {
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
    } else {
        clientX = event.clientX;
        clientY = event.clientY;
    }
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    
    return { x, y };
}

function selectTroopForPlacement(troopId) {
    selectedTroopId = troopId;
    isDragging = true;
    console.log(`📍 Tropa ${troopId} selecionada para arrastar.`);
    
    // Fechar modal automaticamente ao selecionar tropa (para poder arrastar)
    closeShopModal();
    
    // Destacar item selecionado (no sidebar)
    document.querySelectorAll('.inventory-item-sidebar').forEach(item => {
        item.style.border = '2px solid #7f8c8d';
    });
    const selectedItem = document.querySelector(`[data-troop-id="${troopId}"]`);
    if (selectedItem) {
        selectedItem.style.border = '3px solid #f1c40f';
        selectedItem.style.boxShadow = '0 0 10px rgba(241, 196, 15, 0.5)';
    }
    
    // Mensagem será mostrada no canvas durante o arraste
    
    // Adicionar cursor de arrasto no canvas
    canvas.style.cursor = 'grab';
}

// Cancelar drag se soltar fora do canvas
document.addEventListener('mouseup', (e) => {
    if (isDragging && selectedTroopId) {
        // Verificar se soltou dentro do canvas
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Se soltou fora do canvas, cancelar
        if (x < 0 || x > canvas.width || y < 0 || y > canvas.height) {
            cancelDrag();
        }
    }
});

// Handler para soltar tropa no canvas (drag and drop)
function handleCanvasDrop(event) {
    if (!selectedTroopId || !isDragging || !player || !player.troops) {
        cancelDrag();
        return;
    }
    
    // Prevenir múltiplos cliques rápidos (race condition)
    if (placingTroop) {
        console.log('⏳ Tropa já está sendo posicionada, aguarde...');
        return;
    }
    
    // Prevenir comportamento padrão em touch events
    if (event.preventDefault) event.preventDefault();
    
    // Calcular coordenadas corretas considerando o scale do canvas
    const coords = getCanvasCoordinates(event);
    const x = coords.x;
    const y = coords.y;
    
    // Validar posição (deve estar no campo do jogador)
    const validX = player.team === 'left' ? (x >= 0 && x <= canvas.width / 2) : (x >= canvas.width / 2 && x <= canvas.width);
    const validY = y >= 0 && y <= canvas.height;
    
    if (!validX || !validY) {
        // Feedback visual será mostrado no canvas
            setTimeout(() => {
                cancelDrag();
            }, 1500);
        return;
    }
    
    // Enviar posição para o servidor
    if (window.socket && window.socket.connected) {
        placingTroop = true; // Marcar como posicionando
        
        console.log(`📍 Enviando tropa ${selectedTroopId} para posição (${x.toFixed(0)}, ${y.toFixed(0)})`);
        
        window.socket.emit('place_troop', {
            troopId: selectedTroopId,
            x: x,
            y: y
        });
        
        console.log(`✅ Evento place_troop emitido para servidor`);
        
        // Limpar seleção IMEDIATAMENTE após enviar
        const troopIdToPlace = selectedTroopId;
        selectedTroopId = null;
        isDragging = false;
        canvas.style.cursor = 'default';
        
        // Remover destaque (usar o seletor correto do sidebar)
        document.querySelectorAll('.inventory-item-sidebar').forEach(item => {
            item.style.border = '2px solid #7f8c8d';
            item.style.boxShadow = 'none';
        });
        
        // Resetar flag após 500ms (tempo suficiente para o servidor processar)
        setTimeout(() => {
            placingTroop = false;
        }, 500);
    } else {
        console.error('❌ Socket não conectado!');
        cancelDrag();
        placingTroop = false;
    }
}

// Handler para cliques no canvas (fallback para drag and drop e comandos táticos)
function handleCanvasClickForPlacement(event) {
    // Converter touch event para mouse event se necessário
    if (event.touches && event.touches.length > 0) {
        event.clientX = event.touches[0].clientX;
        event.clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) {
        event.clientX = event.changedTouches[0].clientX;
        event.clientY = event.changedTouches[0].clientY;
    }
    
    // Primeiro verificar se clicou nos comandos táticos
    if (handleTacticalCommandClick(event)) {
        event.preventDefault();
        event.stopPropagation();
        return; // Clique foi tratado pelos comandos
    }
    // Se estiver selecionando alvo para focar, tratar primeiro
    if (isSelectingTarget) {
        handleTargetSelection(event);
        return;
    }
    
    // Se estiver arrastando, tratar como drop
    if (isDragging && selectedTroopId) {
        handleCanvasDrop(event);
    }
}

// Marcar jogador como pronto
function setPlayerReady() {
    if (!window.socket || !window.socket.connected) {
        console.log('❌ Socket não conectado');
        return;
    }
    
    // Permitir iniciar mesmo sem posicionar todas as tropas
    const unplacedTroops = player && player.troops ? player.troops.filter(t => !t.placed).length : 0;
    if (unplacedTroops > 0) {
        console.log(`⚠️ Jogador iniciando com ${unplacedTroops} tropa(s) não posicionada(s)`);
    }
    
    console.log('✅ Jogador marcado como pronto!');
    window.socket.emit('player_ready');
    
    // Atualizar botão no modal (se existir)
    const readyBtn = document.getElementById('ready-btn');
    if (readyBtn) {
        readyBtn.disabled = true;
        readyBtn.textContent = '✓ Pronto!';
        readyBtn.style.background = '#27ae60';
    }
    
    // Atualizar botão no topo do canvas
    const readyBtnTop = document.getElementById('ready-btn-top');
    if (readyBtnTop) {
        readyBtnTop.disabled = true;
        readyBtnTop.textContent = '✓ Pronto!';
        readyBtnTop.style.background = '#27ae60';
        readyBtnTop.style.cursor = 'not-allowed';
    }
}

function initWaitingScreen() {
    function drawWaitingScreen() {
        // Limpar canvas
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Texto de espera
        ctx.fillStyle = 'white';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Aguardando jogadores...', canvas.width / 2, canvas.height / 2 - 20);
        
        ctx.font = '16px Arial';
        ctx.fillText('Crie um lobby ou entre em um existente', canvas.width / 2, canvas.height / 2 + 20);
    }
    
    drawWaitingScreen();
    
    // Atualizar a cada segundo
    setInterval(() => {
        if (!gameStarted) {
            drawWaitingScreen();
        }
    }, 1000);
}

// Inicializar jogo
window.initGame = function(gameStateData) {
    console.log('🎮 Inicializando jogo...', gameStateData);
    gameState = gameStateData;
    gameStarted = true;
    
    // Encontrar o jogador atual
    const currentUser = window.currentUser();
    console.log('👤 Usuário atual:', currentUser);
    player = gameState.players.find(p => p.id === currentUser.id);
    
    if (!player) {
        console.error('❌ Jogador não encontrado no estado do jogo');
        console.error('   Players disponíveis:', gameState.players.map(p => ({id: p.id, username: p.username})));
        return;
    }
    
    // Inicializar posição anterior para detecção de movimento
    playerLastPosition = { x: player.position.x, y: player.position.y };
    playerLastMoveTime = Date.now();
    
    console.log('✅ Jogador encontrado:', player);
    console.log('🔌 Socket disponível:', !!window.socket);
    console.log('   Socket conectado:', window.socket?.connected);
    console.log('   Socket ID:', window.socket?.id);
    
    // Esconder controles do lobby
    const lobbyInfo = document.getElementById('lobby-info');
    if (lobbyInfo) {
        lobbyInfo.style.display = 'none';
    }
    
    // Iniciar loop do jogo
    gameLoop();
};

function gameLoop() {
    // Sempre renderizar se tiver gameState (incluindo fase de preparação)
    if (gameState) {
        if (gameStarted) {
            update();
        }
        render();
    }
    requestAnimationFrame(gameLoop);
}

// Função para verificar se pode atravessar o rio (só pelas pontes)
// LÓGICA: Verifica se o caminho passa pelo rio. Se passar, DEVE estar na ponte.
function canCrossRiver(currentX, currentY, newX, newY) {
    const riverLeft = RIVER_LEFT;  // 460
    const riverRight = RIVER_RIGHT; // 540
    const bridgeLeft = BRIDGE_LEFT;  // 440
    const bridgeRight = BRIDGE_RIGHT; // 560
    
    // Áreas das pontes com margem de tolerância (para facilitar o movimento)
    // Usar margem maior para permitir movimento mais natural
    const BRIDGE_TOLERANCE_Y = 50; // Margem de 50 pixels acima e abaixo da ponte
    const topBridgeYStart = TOP_BRIDGE_Y - BRIDGE_TOLERANCE_Y; // 150
    const topBridgeYEnd = TOP_BRIDGE_Y + BRIDGE_HEIGHT + BRIDGE_TOLERANCE_Y; // 265
    const bottomBridgeYStart = BOTTOM_BRIDGE_Y - BRIDGE_TOLERANCE_Y; // 435
    const bottomBridgeYEnd = BOTTOM_BRIDGE_Y + BRIDGE_HEIGHT + BRIDGE_TOLERANCE_Y; // 550
    
    // Verificar se o CAMINHO passa pelo rio (não apenas a posição final)
    const minX = Math.min(currentX, newX);
    const maxX = Math.max(currentX, newX);
    const minY = Math.min(currentY, newY);
    const maxY = Math.max(currentY, newY);
    
    // O caminho passa pelo rio se cruza a área X do rio
    const pathCrossesRiver = (minX <= riverRight && maxX >= riverLeft);
    
    // Se o caminho NÃO passa pelo rio, permitir movimento livre
    if (!pathCrossesRiver) {
        return true;
    }
    
    // O caminho PASSA pelo rio, então DEVE estar em uma ponte
    // Verificar se o caminho está dentro da área de uma ponte (com tolerância)
    
    // Ponte superior: Y entre 195-220 E X entre 440-560
    const onTopBridge = (minY <= topBridgeYEnd && maxY >= topBridgeYStart && 
                         minX <= bridgeRight && maxX >= bridgeLeft);
    
    // Ponte inferior: Y entre 480-505 E X entre 440-560
    const onBottomBridge = (minY <= bottomBridgeYEnd && maxY >= bottomBridgeYStart && 
                            minX <= bridgeRight && maxX >= bridgeLeft);
    
    // Se está em alguma ponte, PERMITIR
    if (onTopBridge || onBottomBridge) {
        return true;
    }
    
    // O caminho passa pelo rio mas NÃO está em uma ponte, BLOQUEAR
    console.log('🚫 BLOQUEADO: Caminho passa pelo rio mas não está na ponte', {
        de: `(${currentX.toFixed(1)}, ${currentY.toFixed(1)})`,
        para: `(${newX.toFixed(1)}, ${newY.toFixed(1)})`,
        rio: `X: ${riverLeft}-${riverRight}`,
        ponteSuperior: `Y: ${topBridgeYStart}-${topBridgeYEnd}, X: ${bridgeLeft}-${bridgeRight}`,
        ponteInferior: `Y: ${bottomBridgeYStart}-${bottomBridgeYEnd}, X: ${bridgeLeft}-${bridgeRight}`,
        caminho: `Y: ${minY.toFixed(1)}-${maxY.toFixed(1)}, X: ${minX.toFixed(1)}-${maxX.toFixed(1)}`
    });
    return false;
}

function update() {
    if (!player || !gameState) {
        console.log('⚠️ update() chamado mas player ou gameState não existe');
        console.log('   player:', !!player);
        console.log('   gameState:', !!gameState);
        return;
    }
    
    const speed = 2.5; // Velocidade igual aos minions melee
    let moved = false;
    const now = Date.now();
    
    // Atualizar flechas locais (feedback visual imediato)
    if (gameState.projectiles) {
        const projectilesToRemove = [];
        gameState.projectiles.forEach(projectile => {
            if (projectile.isLocal && projectile.type === 'arrow_special') {
                // Mover flecha local
                const distanceTraveled = Math.hypot(
                    projectile.x - projectile.startX,
                    projectile.y - projectile.startY
                );
                
                const mapWidth = canvas.width;
                const mapHeight = canvas.height;
                const outOfBounds = projectile.x < 0 || projectile.x > mapWidth || 
                                   projectile.y < 0 || projectile.y > mapHeight;
                
                if (distanceTraveled >= projectile.maxDistance || outOfBounds) {
                    projectilesToRemove.push(projectile.id);
                } else {
                    projectile.x += projectile.directionX * projectile.speed;
                    projectile.y += projectile.directionY * projectile.speed;
                }
            }
        });
        
        // Remover flechas locais que atingiram limite
        if (projectilesToRemove.length > 0) {
            gameState.projectiles = gameState.projectiles.filter(p => !projectilesToRemove.includes(p.id));
        }
    }
    
    // Guardar posição anterior
    const oldX = player.position.x;
    const oldY = player.position.y;
    
    // Calcular direção do movimento
    let moveX = 0;
    let moveY = 0;
    
    // Movimento WASD ou setas
    if (keys['w'] || keys['arrowup']) {
        const newY = Math.max(0, player.position.y - speed);
        const canMove = canCrossRiver(player.position.x, player.position.y, player.position.x, newY);
        if (canMove) {
            player.position.y = newY;
            moveY = -1;
            moved = true;
        }
    }
    if (keys['s'] || keys['arrowdown']) {
        const newY = Math.min(canvas.height, player.position.y + speed);
        const canMove = canCrossRiver(player.position.x, player.position.y, player.position.x, newY);
        if (canMove) {
            player.position.y = newY;
            moveY = 1;
            moved = true;
        }
    }
    if (keys['a'] || keys['arrowleft']) {
        const newX = Math.max(0, player.position.x - speed);
        const canMove = canCrossRiver(player.position.x, player.position.y, newX, player.position.y);
        if (canMove) {
            player.position.x = newX;
            moveX = -1;
            moved = true;
        }
    }
    if (keys['d'] || keys['arrowright']) {
        const newX = Math.min(canvas.width, player.position.x + speed);
        const canMove = canCrossRiver(player.position.x, player.position.y, newX, player.position.y);
        if (canMove) {
            player.position.x = newX;
            moveX = 1;
            moved = true;
        }
    }
    
    // Atualizar última direção do movimento (considerar movimento diagonal)
    if (moved && (moveX !== 0 || moveY !== 0)) {
        // Normalizar direção diagonal
        const length = Math.sqrt(moveX * moveX + moveY * moveY);
        if (length > 0) {
            lastPlayerDirection = { x: moveX / length, y: moveY / length };
        } else {
            lastPlayerDirection = { x: moveX, y: moveY };
        }
        // Atualizar timestamp do movimento para animação
        playerLastMoveTime = now;
    }
    
    // Atualizar última posição para detectar movimento na renderização
    if (moved) {
        playerLastPosition = { x: oldX, y: oldY };
    }
    
    // Enviar movimento para o servidor
    if (moved && window.socket && window.socket.connected) {
        window.socket.emit('player_move', {
            position: { x: player.position.x, y: player.position.y },
            timestamp: Date.now()
        });
    }
    
    // Atualizar animações de ataque (remover antigas)
    attacks = attacks.filter(attack => now - attack.timestamp < 300);
    
    // Atualizar damage texts (remover antigos)
    damageTexts = damageTexts.filter(text => now - text.timestamp < 1000);
    
    // Sincronizar com estado do servidor
    if (gameState.attacks) {
        gameState.attacks.forEach(serverAttack => {
            if (!attacks.find(a => a.id === serverAttack.id)) {
                attacks.push(serverAttack);
            }
        });
    }
}

function render() {
    // Renderizar durante preparação também
    if (!gameState) return;
    
    // Renderizar se estiver na fase de preparação OU se o jogo começou
    if (!gameStarted && gameState.status !== 'preparing' && !gameState.towers) return;
    
    // Log de debug das pontes (desabilitado na FASE 1)
    // Será reativado na FASE 2 quando as pontes forem adicionadas
    
    // Desenhar fundo do campo de batalha
    if (battlefieldBackground) {
        // Desenhar imagem de fundo (preencher todo o canvas)
        ctx.drawImage(battlefieldBackground, 0, 0, canvas.width, canvas.height);
    } else {
        // Fallback: cor sólida se a imagem não carregou
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    // Desenhar rio no meio do mapa (VERTICAL - dividindo os dois campos)
    // Usar constantes compartilhadas
    const riverStartX = RIVER_LEFT;
    
    // Desenhar rio com gradiente (vertical)
    const riverGradient = ctx.createLinearGradient(riverStartX, 0, riverStartX + RIVER_WIDTH, 0);
    riverGradient.addColorStop(0, '#1e3a5f'); // Azul escuro (profundidade)
    riverGradient.addColorStop(0.5, '#2e5a8a'); // Azul médio
    riverGradient.addColorStop(1, '#1e3a5f'); // Azul escuro
    
    ctx.fillStyle = riverGradient;
    ctx.fillRect(riverStartX, 0, RIVER_WIDTH, canvas.height);
    
    // Efeito de ondas/ondulações no rio (vertical)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        const waveX = riverStartX + (RIVER_WIDTH / 5) * (i + 0.5);
        ctx.moveTo(waveX, 0);
        for (let y = 0; y < canvas.height; y += 20) {
            const waveOffset = Math.sin((y / 30) + (Date.now() / 2000)) * 3;
            ctx.lineTo(waveX + waveOffset, y);
        }
        ctx.stroke();
    }
    
    // Bordas do rio (margens verticais)
    ctx.fillStyle = '#3d2817'; // Marrom escuro para margens
    ctx.fillRect(riverStartX - 5, 0, 5, canvas.height);
    ctx.fillRect(riverStartX + RIVER_WIDTH, 0, 5, canvas.height);
    
    // FASE 2: Desenhar duas pontes HORIZONTAIS ligando os dois campos
    // Usar constantes compartilhadas
    const bridgeX = BRIDGE_LEFT;
    
    // Ponte superior (ligando campos na parte superior)
    const topBridgeY = TOP_BRIDGE_Y;
    
    // Background visual da área de passagem (ponte superior)
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#2ecc71'; // Verde semi-transparente para indicar área segura
    ctx.fillRect(bridgeX - 5, topBridgeY, BRIDGE_WIDTH + 10, BRIDGE_HEIGHT);
    ctx.restore();
    
    // Borda da área de passagem (ponte superior)
    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(bridgeX - 5, topBridgeY, BRIDGE_WIDTH + 10, BRIDGE_HEIGHT);
    ctx.setLineDash([]);
    
    // Ponte superior (madeira marrom)
    ctx.fillStyle = '#8b4513'; // Marrom para madeira
    ctx.fillRect(bridgeX, topBridgeY, BRIDGE_WIDTH, BRIDGE_HEIGHT);
    
    // Detalhes da ponte superior (tábuas horizontais)
    ctx.strokeStyle = '#654321';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(bridgeX, topBridgeY + (BRIDGE_HEIGHT / 6) * i);
        ctx.lineTo(bridgeX + BRIDGE_WIDTH, topBridgeY + (BRIDGE_HEIGHT / 6) * i);
        ctx.stroke();
    }
    
    // Corrimão da ponte superior
    ctx.fillStyle = '#654321';
    ctx.fillRect(bridgeX - 8, topBridgeY - 3, 4, BRIDGE_HEIGHT + 6);
    ctx.fillRect(bridgeX + BRIDGE_WIDTH + 4, topBridgeY - 3, 4, BRIDGE_HEIGHT + 6);
    
    // Ponte inferior (ligando campos na parte inferior)
    const bottomBridgeY = BOTTOM_BRIDGE_Y;
    
    // Background visual da área de passagem (ponte inferior)
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#2ecc71'; // Verde semi-transparente para indicar área segura
    ctx.fillRect(bridgeX - 5, bottomBridgeY - 2, BRIDGE_WIDTH + 10, BRIDGE_HEIGHT + 4);
    ctx.restore();
    
    // Borda da área de passagem (ponte inferior)
    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(bridgeX - 5, bottomBridgeY - 2, BRIDGE_WIDTH + 10, BRIDGE_HEIGHT + 4);
    ctx.setLineDash([]);
    
    // Ponte inferior (madeira marrom)
    ctx.fillStyle = '#8b4513'; // Marrom para madeira
    ctx.fillRect(bridgeX, bottomBridgeY, BRIDGE_WIDTH, BRIDGE_HEIGHT);
    
    // Detalhes da ponte inferior (tábuas horizontais)
    ctx.strokeStyle = '#654321';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(bridgeX, bottomBridgeY + (BRIDGE_HEIGHT / 6) * i);
        ctx.lineTo(bridgeX + BRIDGE_WIDTH, bottomBridgeY + (BRIDGE_HEIGHT / 6) * i);
        ctx.stroke();
    }
    
    // Corrimão da ponte inferior
    ctx.fillStyle = '#654321';
    ctx.fillRect(bridgeX - 8, bottomBridgeY - 3, 4, BRIDGE_HEIGHT + 6);
    ctx.fillRect(bridgeX + BRIDGE_WIDTH + 4, bottomBridgeY - 3, 4, BRIDGE_HEIGHT + 6);
    
    // Sombra das pontes no rio
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000000';
    ctx.fillRect(bridgeX, topBridgeY + BRIDGE_HEIGHT, BRIDGE_WIDTH, 10);
    ctx.fillRect(bridgeX, bottomBridgeY + BRIDGE_HEIGHT, BRIDGE_WIDTH, 10);
    ctx.restore();
    
    // Desenhar linha do meio (divisão do campo) - mais visível sobre o fundo
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 3;
    ctx.setLineDash([15, 10]);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    // Sombra da linha para melhor visibilidade
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 5;
    ctx.setLineDash([15, 10]);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Desenhar terreno (gargalos, altura, cobertura)
    if (gameState.terrain) {
      // Gargalos (áreas estreitas - marrom)
      if (gameState.terrain.chokepoints) {
        gameState.terrain.chokepoints.forEach(area => {
          ctx.save();
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = '#8b4513';
          ctx.fillRect(area.x, area.y, area.width, area.height);
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = '#654321';
          ctx.lineWidth = 2;
          ctx.strokeRect(area.x, area.y, area.width, area.height);
          ctx.restore();
        });
      }
      
      // Terreno elevado (vantagem de altura - verde claro)
      if (gameState.terrain.highGround) {
        gameState.terrain.highGround.forEach(area => {
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = '#90ee90';
          ctx.fillRect(area.x, area.y, area.width, area.height);
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = '#32cd32';
          ctx.lineWidth = 2;
          ctx.strokeRect(area.x, area.y, area.width, area.height);
          // Ícone de altura
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = '#32cd32';
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('⬆️', area.x + area.width/2, area.y + area.height/2);
          ctx.restore();
        });
      }
      
      // Cobertura (reduz dano - cinza)
      if (gameState.terrain.cover) {
        gameState.terrain.cover.forEach(area => {
          ctx.save();
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = '#696969';
          ctx.fillRect(area.x, area.y, area.width, area.height);
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = '#2f2f2f';
          ctx.lineWidth = 2;
          ctx.strokeRect(area.x, area.y, area.width, area.height);
          // Ícone de cobertura
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = '#2f2f2f';
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('🛡️', area.x + area.width/2, area.y + area.height/2);
          ctx.restore();
        });
      }
    }
    
    // Destacar campo válido para posicionamento (durante preparação)
    if (player && selectedTroopId) {
        const isPreparing = gameState.status === 'preparing';
        if (isPreparing) {
            ctx.save();
            // Campo do jogador (esquerda ou direita)
            const fieldX = player.team === 'left' ? 0 : canvas.width / 2;
            const fieldY = 0;
            const fieldWidth = canvas.width / 2;
            const fieldHeight = canvas.height;
            
            // Fundo semi-transparente do campo válido
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = player.team === 'left' ? '#3498db' : '#e74c3c';
            ctx.fillRect(fieldX, fieldY, fieldWidth, fieldHeight);
            
            // Borda destacada do campo válido
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = player.team === 'left' ? '#3498db' : '#e74c3c';
            ctx.lineWidth = 4;
            ctx.strokeRect(fieldX, fieldY, fieldWidth, fieldHeight);
            
            // Texto indicativo
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = player.team === 'left' ? '#3498db' : '#e74c3c';
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('SEU CAMPO', fieldX + fieldWidth / 2, fieldHeight / 2);
            ctx.font = '16px Arial';
            ctx.fillText('Clique aqui para posicionar', fieldX + fieldWidth / 2, fieldHeight / 2 + 30);
            
            ctx.restore();
        }
    }
    
    // Desenhar torres
    gameState.towers.forEach(tower => {
        if (tower.health <= 0) {
            // Torre destruída - desenhar escombros
            ctx.save();
            ctx.globalAlpha = 0.5;
            if (towerImage) {
                const towerSize = 60;
                ctx.drawImage(towerImage, tower.x - towerSize/2, tower.y - towerSize/2, towerSize, towerSize);
            } else {
            ctx.fillStyle = '#7f8c8d';
                ctx.fillRect(tower.x - 30, tower.y - 30, 60, 60);
            }
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#2c3e50';
            ctx.font = '20px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('💥', tower.x, tower.y);
            ctx.restore();
            return;
        }
        
        // Desenhar alcance da torre (círculo semi-transparente)
        const towerAttackRange = 350; // Mesmo valor do servidor
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = tower.team === 'left' ? '#3498db' : '#e74c3c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, towerAttackRange, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
        
        // Desenhar sprite da torre
        const towerSize = 60; // Tamanho da torre (ajustado para o sprite)
        if (towerImage) {
            ctx.save();
            // Aplicar cor do time como filtro (opcional - pode remover se quiser cor original)
            if (tower.team === 'left') {
                ctx.globalCompositeOperation = 'multiply';
                ctx.fillStyle = '#3498db';
                ctx.fillRect(tower.x - towerSize/2, tower.y - towerSize/2, towerSize, towerSize);
                ctx.globalCompositeOperation = 'source-over';
            }
            ctx.drawImage(towerImage, tower.x - towerSize/2, tower.y - towerSize/2, towerSize, towerSize);
            ctx.restore();
        } else {
            // Fallback: retângulo se a imagem não carregou
        ctx.fillStyle = tower.team === 'left' ? '#3498db' : '#e74c3c';
            ctx.fillRect(tower.x - towerSize/2, tower.y - towerSize/2, towerSize, towerSize);
        
        // Borda da torre
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 2;
            ctx.strokeRect(tower.x - towerSize/2, tower.y - towerSize/2, towerSize, towerSize);
        }
        
        // Barra de vida da torre (sempre visível)
        const barWidth = 50;
        const barHeight = 6;
        const barX = tower.x - barWidth/2;
        const barY = tower.y - 35;
        
        // Fundo da barra
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        
        // Barra de vida (cor muda conforme HP)
        const healthPercent = tower.health / (tower.maxHealth || 100);
        ctx.fillStyle = healthPercent > 0.5 ? '#2ecc71' : healthPercent > 0.25 ? '#f39c12' : '#e74c3c';
        ctx.fillRect(barX, barY, healthPercent * barWidth, barHeight);
        
        // Borda da barra
        ctx.strokeStyle = '#ecf0f1';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);
        
        // Texto com HP
        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.ceil(tower.health)}/${tower.maxHealth || 100}`, tower.x, barY - 3);
    });
    
    // Desenhar jogadores com sprites
    const renderTime = Date.now();
    gameState.players.forEach(p => {
        const isCurrentPlayer = player && p.id === player.id;
        
        // Determinar animação baseada no movimento
        let animationType = 'idle';
        let direction = 1; // 1 = direita, -1 = esquerda
        
        if (isCurrentPlayer) {
            // Verificar se está atacando (prioridade sobre movimento)
            const timeSinceLastAttack = renderTime - playerLastAttackTime;
            const isAttacking = timeSinceLastAttack < 500; // Animação de ataque dura 500ms
            
            if (isAttacking) {
                // Está atacando - usar animação de ataque
                animationType = 'attack';
                direction = lastPlayerDirection.x > 0 ? 1 : -1;
            } else {
                // Para o jogador atual, usar teclas pressionadas e posição
                const isMoving = keys['w'] || keys['s'] || keys['a'] || keys['d'] || 
                                keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'];
                const moved = Math.hypot(p.position.x - playerLastPosition.x, p.position.y - playerLastPosition.y) > 1;
                
                // Verificar se REALMENTE está se movendo (tecla pressionada E há movimento detectado)
                // Isso evita animação de corrida quando parado
                if (isMoving && moved) {
                    // Está se movendo - usar animação de corrida
                    animationType = 'run';
                    // Determinar direção baseada no movimento horizontal ou teclas
                    if (Math.abs(p.position.x - playerLastPosition.x) > 0.5) {
                        direction = (p.position.x - playerLastPosition.x) > 0 ? 1 : -1;
                    } else {
                        // Se movimento apenas vertical, usar direção baseada nas teclas
                        if (keys['d'] || keys['arrowright']) direction = 1;
                        else if (keys['a'] || keys['arrowleft']) direction = -1;
                        else direction = lastPlayerDirection.x > 0 ? 1 : -1;
                    }
                } else {
                    // Parado - usar animação idle imediatamente
                    animationType = 'idle';
                    direction = lastPlayerDirection.x > 0 ? 1 : -1;
                }
            }
        } else {
            // Para outros jogadores, verificar se há última posição armazenada
            if (!p.lastPosition) p.lastPosition = { x: p.position.x, y: p.position.y };
            const moved = Math.hypot(p.position.x - p.lastPosition.x, p.position.y - p.lastPosition.y) > 2;
            
            if (moved) {
                animationType = 'run';
                direction = (p.position.x - p.lastPosition.x) > 0 ? 1 : -1;
            } else {
                animationType = 'idle';
                direction = 1; // Padrão: direita
            }
            
            // Atualizar última posição
            p.lastPosition = { x: p.position.x, y: p.position.y };
        }
        
        // Tamanho do sprite do jogador (maior que minions)
        const playerSpriteWidth = 28 * 4.5; // ~126px
        const playerSpriteHeight = 28 * 3.5; // ~98px
        const spritePrefix = p.team === 'left' ? 'melee' : 'melee'; // Usar sprites melee para ambos os times
        
        // Renderizar sprite do jogador
        if (spriteManager && spriteManager.loaded) {
            spriteManager.drawAnimatedSprite(
                ctx,
                `player_${p.id}`,
                `${spritePrefix}_${animationType}`,
                p.position.x,
                p.position.y,
                playerSpriteWidth,
                playerSpriteHeight,
                direction
            );
        } else {
            // Fallback: círculo simples
        ctx.fillStyle = p.team === 'left' ? '#3498db' : '#e74c3c';
        ctx.beginPath();
        ctx.arc(p.position.x, p.position.y, 18, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 2;
        ctx.stroke();
        }
        
        // Nome do jogador
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 3;
        ctx.strokeText(p.username, p.position.x, p.position.y - playerSpriteHeight / 2 - 10);
        ctx.fillText(p.username, p.position.x, p.position.y - playerSpriteHeight / 2 - 10);
        
        // Barra de vida
        const barWidth = 50;
        const barHeight = 6;
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(p.position.x - barWidth/2, p.position.y - playerSpriteHeight / 2 - 5, barWidth, barHeight);
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(p.position.x - barWidth/2, p.position.y - playerSpriteHeight / 2 - 5, (p.health / p.maxHealth) * barWidth, barHeight);
    });
    
    // Desenhar marcações das tropas já posicionadas (durante preparação)
    const isPreparing = gameState.status === 'preparing';
    
    // Renderizar tropas de player.troops (durante preparação)
    if (isPreparing && player && player.troops) {
        const placedTroops = player.troops.filter(t => t.placed);
        console.log(`🎯 Renderizando ${placedTroops.length} tropas posicionadas do player.troops`);
        placedTroops.forEach(troop => {
            if (troop.x && troop.y) {
                ctx.save();
                const isRanged = troop.type === 'ranged';
                const size = troop.size || 16;
                
                // Círculo de marcação GRANDE e VISÍVEL
                ctx.globalAlpha = 0.4;
                ctx.fillStyle = player.team === 'left' ? '#3498db' : '#e74c3c';
                ctx.beginPath();
                ctx.arc(troop.x, troop.y, size + 8, 0, Math.PI * 2);
                ctx.fill();
                
                // Borda externa da marcação (bem visível)
                ctx.globalAlpha = 0.8;
                ctx.strokeStyle = player.team === 'left' ? '#3498db' : '#e74c3c';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(troop.x, troop.y, size + 8, 0, Math.PI * 2);
                ctx.stroke();
                
                // Ícone da tropa (bem visível)
                ctx.globalAlpha = 0.9;
                ctx.fillStyle = player.team === 'left' ? '#3498db' : '#e74c3c';
                if (isRanged) {
                    ctx.beginPath();
                    ctx.arc(troop.x, troop.y, size / 2, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.fillRect(troop.x - size / 2, troop.y - size / 2, size, size);
                }
                
                // Borda interna da tropa
                ctx.globalAlpha = 1;
                ctx.strokeStyle = '#2c3e50';
                ctx.lineWidth = 2;
                if (isRanged) {
                    ctx.stroke();
                } else {
                    ctx.strokeRect(troop.x - size / 2, troop.y - size / 2, size, size);
                }
                
                // Ícone de check acima da tropa
                ctx.fillStyle = '#2ecc71';
                ctx.font = 'bold 16px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('✓', troop.x, troop.y - size - 10);
                
                ctx.restore();
            }
        });
    }
    
    // Desenhar preview da tropa sendo arrastada (durante preparação)
    if (isDragging && player && player.troops && selectedTroopId) {
        const troop = player.troops.find(t => t.id === selectedTroopId && !t.placed);
        if (troop) {
            // Validar posição do mouse
            const validX = player.team === 'left' ? (mouseX >= 0 && mouseX <= canvas.width / 2) : (mouseX >= canvas.width / 2 && mouseX <= canvas.width);
            const validY = mouseY >= 0 && mouseY <= canvas.height;
            const isValid = validX && validY;
            
            ctx.save();
            const isRanged = troop.type === 'ranged';
            const size = troop.size || 16;
            
            // Círculo de preview maior e mais visível
            if (isValid) {
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = player.team === 'left' ? '#3498db' : '#e74c3c';
                ctx.beginPath();
                ctx.arc(mouseX, mouseY, size + 5, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Preview da tropa (mais opaco se válido)
            ctx.globalAlpha = isValid ? 0.9 : 0.4;
            ctx.fillStyle = isValid 
                ? (player.team === 'left' ? '#3498db' : '#e74c3c')
                : '#e74c3c'; // Vermelho se posição inválida
            
            if (isRanged) {
                ctx.beginPath();
                ctx.arc(mouseX, mouseY, size / 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#2c3e50';
                ctx.lineWidth = 2;
                ctx.stroke();
            } else {
                ctx.fillRect(mouseX - size / 2, mouseY - size / 2, size, size);
                ctx.strokeStyle = '#2c3e50';
                ctx.lineWidth = 2;
                ctx.strokeRect(mouseX - size / 2, mouseY - size / 2, size, size);
            }
            
            // Indicador visual de posição válida/inválida
            ctx.globalAlpha = 1;
            ctx.fillStyle = isValid ? '#2ecc71' : '#e74c3c';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(isValid ? '✓' : '✗', mouseX, mouseY - size - 8);
            
            ctx.restore();
        }
    }
    
    // Desenhar minions (tropas posicionadas) - SEMPRE renderizar se existirem
    if (gameState.minions && gameState.minions.length > 0) {
        const now = Date.now();
        // Log para debug (sempre mostrar quando há minions)
        console.log(`🎯 Renderizando ${gameState.minions.length} minions no mapa (status: ${gameState.status || 'unknown'})`);
        gameState.minions.forEach(minion => {
            // Log detalhado do primeiro minion para debug
            if (gameState.minions.indexOf(minion) === 0) {
                console.log(`   Minion 0: id=${minion.id}, x=${minion.x?.toFixed(0)}, y=${minion.y?.toFixed(0)}, team=${minion.team}, type=${minion.type}`);
            }
            // Destacar tropas recém-posicionadas (últimos 2 segundos)
            const isRecentlyPlaced = minion.placedTime && (now - minion.placedTime) < 2000;
            // Tamanho do minion baseado no upgradeLevel
            const minionSize = minion.size || 16;
            const halfSize = minionSize / 2;
            const isRanged = minion.type === 'ranged';
            
            // Destacar tropas recém-posicionadas com círculo pulsante
            if (isRecentlyPlaced) {
                const pulseProgress = ((now - minion.placedTime) / 2000);
                const pulseAlpha = 0.5 * (1 - pulseProgress);
                ctx.save();
                ctx.globalAlpha = pulseAlpha;
                ctx.strokeStyle = '#f1c40f';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(minion.x, minion.y, minionSize + 5, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
            
            // Verificar se o minion está morto
            const isDead = minion.health <= 0;
            
            // Se morreu, registrar o tempo de morte
            if (isDead && !minion.deathTime) {
                minion.deathTime = now;
            }
            
            // Determinar animação baseada no estado do minion (igual ao personagem principal)
            let animationType = 'idle';
            let direction = 1; // 1 = direita, -1 = esquerda
            
            // Se está morto, usar animação de morte
            if (isDead) {
                animationType = 'death';
                // Manter direção anterior
                if (minion.lastDirection !== undefined) {
                    direction = minion.lastDirection;
                }
            } else {
                // Inicializar lastPosition e lastMoveTime se não existirem (igual ao jogador)
                if (!minion.lastPosition) {
                    minion.lastPosition = { x: minion.x, y: minion.y };
                }
                if (!minion.lastMoveTime) {
                    minion.lastMoveTime = now;
                }
                
                // Verificar se está atacando (prioridade)
                const isAttacking = minion.lastAttackAnimation && (now - minion.lastAttackAnimation) < 500;
                
                // Verificar se o time do minion tem comando tático "stop" ou "defend" ativo
                const teamPlayer = gameState.players.find(p => p.team === minion.team);
                const hasStopOrDefendCommand = teamPlayer && (teamPlayer.tacticalCommand === 'stop' || teamPlayer.tacticalCommand === 'defend');
                
                if (isAttacking) {
                    animationType = 'attack';
                    // Manter direção baseada no último movimento ou padrão
                    if (minion.lastPosition) {
                        const lastDir = (minion.x - minion.lastPosition.x);
                        if (Math.abs(lastDir) > 0.1) {
                            direction = lastDir > 0 ? 1 : -1;
                        }
                    }
                } else if (hasStopOrDefendCommand) {
                    // Se tem comando "stop" ou "defend", forçar animação idle (parar animação de corrida)
                    animationType = 'idle';
                    // Manter direção anterior
                    if (minion.lastDirection !== undefined) {
                        direction = minion.lastDirection;
                    }
                } else {
                    // Usar EXATAMENTE a mesma lógica do personagem principal
                    const moved = Math.hypot(minion.x - minion.lastPosition.x, minion.y - minion.lastPosition.y) > 1; // Threshold igual ao jogador (1 pixel)
                    
                    // IMPORTANTE: Atualizar lastMoveTime SEMPRE que há movimento (igual ao jogador faz no update())
                    // Isso simula movimento contínuo (como tecla pressionada)
                    if (moved) {
                        minion.lastMoveTime = now;
                    }
                    
                    const timeSinceLastMove = now - minion.lastMoveTime;
                    
                    // Determinar direção baseada no movimento horizontal (igual ao jogador)
                    if (Math.abs(minion.x - minion.lastPosition.x) > 0.5) {
                        direction = (minion.x - minion.lastPosition.x) > 0 ? 1 : -1;
                    } else {
                        // Manter direção anterior (igual ao jogador)
                        if (minion.lastDirection !== undefined) {
                            direction = minion.lastDirection;
                        }
                    }
                    
                    // Salvar direção atual para próxima frame
                    minion.lastDirection = direction;
                    
                    // Usar lógica similar ao jogador: se está se movendo, mostrar corrida
                    // Mas manter suavidade durante movimento contínuo (como quando segura tecla)
                    // Cortar imediatamente quando realmente parar (timeSinceLastMove > 100ms)
                    if (moved || timeSinceLastMove < 100) {
                        // Está se movendo OU acabou de parar (transição suave de 100ms)
                        animationType = 'run';
                    } else {
                        // Parado - usar animação idle imediatamente após 100ms
                        animationType = 'idle';
                    }
                }
            }
            
            // Atualizar última posição para próxima frame (sempre atualizar, apenas se não estiver morto)
            if (!isDead) {
                minion.lastPosition = { x: minion.x, y: minion.y };
            }
            
            // Renderizar sprite do minion (tamanho igual ao jogador)
            const spriteWidth = 28 * 4.5; // ~126px (igual ao jogador)
            const spriteHeight = 28 * 3.5; // ~98px (igual ao jogador)
            const spritePrefix = isRanged ? 'ranged' : 'melee';
            const fullAnimationName = `${spritePrefix}_${animationType}`;
            
            // Se está morto, aplicar transparência gradual
            if (isDead) {
                const deathDuration = 2000; // 2 segundos para animação de morte
                const timeSinceDeath = now - (minion.deathTime || now);
                const deathProgress = Math.min(timeSinceDeath / deathDuration, 1);
                ctx.save();
                ctx.globalAlpha = 1 - (deathProgress * 0.7); // Fade out gradual (até 30% de opacidade)
            }
            
            // Usar sprite se disponível, senão usar fallback
            if (spriteManager && spriteManager.loaded) {
                spriteManager.drawAnimatedSprite(
                    ctx,
                    minion.id,
                    fullAnimationName,
                    minion.x,
                    minion.y,
                    spriteWidth,
                    spriteHeight,
                    direction
                );
            } else {
                // Fallback: desenhar forma simples
            ctx.fillStyle = minion.team === 'left' ? '#3498db' : '#e74c3c';
            if (isRanged) {
                ctx.beginPath();
                ctx.arc(minion.x, minion.y, halfSize, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillRect(minion.x - halfSize, minion.y - halfSize, minionSize, minionSize);
                }
            }
            
            // Restaurar contexto se estava morto (fade out)
            if (isDead) {
                ctx.restore();
            }
            
            // Não renderizar barras de vida/moral se estiver morto
            if (!isDead) {
                // Borda
            ctx.strokeStyle = isRecentlyPlaced ? '#f1c40f' : '#2c3e50';
            ctx.lineWidth = isRecentlyPlaced ? 2 : 1;
            if (isRanged) {
                ctx.stroke();
            } else {
                ctx.strokeRect(minion.x - halfSize, minion.y - halfSize, minionSize, minionSize);
                }
            }
            
            // Mostrar nível acima do minion
            if (minion.upgradeLevel && minion.upgradeLevel > 0) {
                ctx.fillStyle = '#f1c40f';
                ctx.font = 'bold 10px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(`Lv.${minion.upgradeLevel}`, minion.x, minion.y - spriteHeight / 2 - 5);
            }
            
            // Animação de ataque do minion (visual adicional)
            if (minion.lastAttackAnimation && (now - minion.lastAttackAnimation) < 300) {
                const attackAge = now - minion.lastAttackAnimation;
                const attackProgress = attackAge / 300;
                const attackAlpha = 1 - attackProgress;
                
                // Encontrar alvo mais próximo para direção do ataque
                let attackAngle = 0;
                
                // Verificar jogadores inimigos
                const enemyPlayers = gameState.players.filter(p => 
                    p.team !== minion.team && p.health > 0
                );
                let closestEnemy = null;
                let minDist = Infinity;
                
                enemyPlayers.forEach(player => {
                    const dist = Math.hypot(
                        minion.x - player.position.x,
                        minion.y - player.position.y
                    );
                    if (dist < minDist && dist < 30) {
                        minDist = dist;
                        closestEnemy = player;
                    }
                });
                
                // Verificar minions inimigos
                if (!closestEnemy) {
                    const enemyMinions = gameState.minions.filter(m => 
                        m.team !== minion.team && m.health > 0 && m.id !== minion.id
                    );
                    enemyMinions.forEach(enemy => {
                        const dist = Math.hypot(minion.x - enemy.x, minion.y - enemy.y);
                        if (dist < minDist && dist < 30) {
                            minDist = dist;
                            closestEnemy = enemy;
                        }
                    });
                }
                
                // Calcular ângulo do ataque
                if (closestEnemy) {
                    const targetX = closestEnemy.position ? closestEnemy.position.x : closestEnemy.x;
                    const targetY = closestEnemy.position ? closestEnemy.position.y : closestEnemy.y;
                    attackAngle = Math.atan2(targetY - minion.y, targetX - minion.x);
                }
                
                // Desenhar animação de soco (linha curta)
                const punchLength = 20;
                const punchWidth = 4;
                ctx.strokeStyle = minion.team === 'left' 
                    ? `rgba(52, 152, 219, ${attackAlpha})` 
                    : `rgba(231, 76, 60, ${attackAlpha})`;
                ctx.lineWidth = punchWidth;
                ctx.beginPath();
                ctx.moveTo(minion.x, minion.y);
                ctx.lineTo(
                    minion.x + Math.cos(attackAngle) * punchLength,
                    minion.y + Math.sin(attackAngle) * punchLength
                );
                ctx.stroke();
                
                // Efeito de impacto (círculo pequeno)
                ctx.fillStyle = minion.team === 'left'
                    ? `rgba(52, 152, 219, ${attackAlpha * 0.5})`
                    : `rgba(231, 76, 60, ${attackAlpha * 0.5})`;
                ctx.beginPath();
                ctx.arc(
                    minion.x + Math.cos(attackAngle) * punchLength,
                    minion.y + Math.sin(attackAngle) * punchLength,
                    5 * (1 - attackProgress),
                    0,
                    Math.PI * 2
                );
                ctx.fill();
            }
            
            // Barra de vida do minion (sempre visível) - apenas se não estiver morto
            if (!isDead) {
            const barWidth = 20;
            const barHeight = 3;
                let barY = minion.y - 15;
                
                // Barra de defesa (se existir e estiver em modo defender)
                if (minion.defenseShield && minion.defenseShield > 0 && minion.maxDefenseShield) {
                    const defenseBarHeight = 2;
                    const defenseBarY = barY - 4; // Abaixo da barra de vida
            ctx.fillStyle = '#2c3e50';
                    ctx.fillRect(minion.x - barWidth/2, defenseBarY, barWidth, defenseBarHeight);
                    ctx.fillStyle = '#3498db'; // Azul para escudo
                    const shieldPercent = minion.defenseShield / minion.maxDefenseShield;
                    ctx.fillRect(minion.x - barWidth/2, defenseBarY, shieldPercent * barWidth, defenseBarHeight);
                    barY = defenseBarY - 4; // Ajustar posição da barra de vida
                }
                
                // Barra de vida
                ctx.fillStyle = '#2c3e50';
                ctx.fillRect(minion.x - barWidth/2, barY, barWidth, barHeight);
            ctx.fillStyle = '#2ecc71';
                ctx.fillRect(minion.x - barWidth/2, barY, (minion.health / minion.maxHealth) * barWidth, barHeight);
                
            }
            
            // Indicador de habilidade especial do arqueiro (se pronto) - apenas se não estiver morto
            if (!isDead && minion.type === 'ranged' && minion.specialAttackReady) {
                ctx.save();
                ctx.globalAlpha = 0.8;
                ctx.strokeStyle = '#f1c40f';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(minion.x, minion.y, minionSize + 3, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = '#f1c40f';
                ctx.font = 'bold 10px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('⭐', minion.x, minion.y - 30);
                ctx.restore();
            }
        });
    }
    
    // Desenhar projéteis
    if (gameState.projectiles && gameState.projectiles.length > 0) {
        gameState.projectiles.forEach(projectile => {
            ctx.save();
            
            // Flecha especial tem visual diferente
            if (projectile.type === 'arrow_special') {
                // Desenhar flecha especial (maior e mais brilhante)
                const arrowLength = 25;
                const arrowWidth = 8;
                const angle = Math.atan2(projectile.directionY, projectile.directionX);
                
                ctx.translate(projectile.x, projectile.y);
                ctx.rotate(angle);
                
                // Cor da flecha especial (dourada/amarela brilhante)
                ctx.fillStyle = '#FFD700';
                ctx.strokeStyle = '#FFA500';
                ctx.lineWidth = 2;
                
                // Desenhar corpo da flecha
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(arrowLength, 0);
                ctx.stroke();
                
                // Desenhar ponta da flecha
                ctx.beginPath();
                ctx.moveTo(arrowLength, 0);
                ctx.lineTo(arrowLength - arrowWidth, -arrowWidth/2);
                ctx.lineTo(arrowLength - arrowWidth, arrowWidth/2);
                ctx.closePath();
                ctx.fill();
                
                // Brilho/aura da flecha especial
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#FFD700';
                ctx.beginPath();
                ctx.arc(0, 0, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            } else {
                // Projétil normal
                ctx.strokeStyle = projectile.team === 'left' ? '#3498db' : '#e74c3c';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(projectile.x, projectile.y);
                
                // Calcular direção do projétil
                const dx = projectile.targetX - projectile.x;
                const dy = projectile.targetY - projectile.y;
                const distance = Math.hypot(dx, dy);
                
                if (distance > 0) {
                    // Desenhar linha na direção do alvo
                    const lineLength = Math.min(15, distance);
                    ctx.lineTo(
                        projectile.x + (dx / distance) * lineLength,
                        projectile.y + (dy / distance) * lineLength
                    );
                }
                ctx.stroke();
                
                // Desenhar círculo no início do projétil
                ctx.fillStyle = projectile.team === 'left' ? '#3498db' : '#e74c3c';
                ctx.beginPath();
                ctx.arc(projectile.x, projectile.y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        });
    }
    
    // Desenhar moedas
    if (gameState.coins && gameState.coins.length > 0) {
        const now = Date.now();
        gameState.coins.forEach(coin => {
            if (coin.collected) return;
            
            // Calcular tempo restante
            const age = now - (coin.spawnTime || 0);
            const lifetime = coin.lifetime || 10000;
            const timeLeft = lifetime - age;
            const timePercent = Math.max(0, Math.min(1, timeLeft / lifetime));
            
            // Efeito de piscar quando está prestes a expirar (últimos 3 segundos)
            const blink = timeLeft < 3000 && Math.floor(now / 200) % 2 === 0;
            
            // Moeda dourada brilhante (mais opaca quando está prestes a expirar)
            const alpha = timePercent < 0.3 ? (blink ? 0.3 : 0.6) : 1;
            ctx.globalAlpha = alpha;
            
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath();
            ctx.arc(coin.x, coin.y, 10, 0, Math.PI * 2);
            ctx.fill();
            
            // Borda dourada (vermelha quando está prestes a expirar)
            ctx.strokeStyle = timePercent < 0.3 ? '#e74c3c' : '#d4ac0d';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Brilho interno
            ctx.fillStyle = '#f7dc6f';
            ctx.beginPath();
            ctx.arc(coin.x - 3, coin.y - 3, 4, 0, Math.PI * 2);
            ctx.fill();
            
            // Símbolo de moeda ($)
            ctx.fillStyle = '#2c3e50';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('$', coin.x, coin.y + 4);
            
            // Barra de tempo restante (quando está prestes a expirar)
            if (timePercent < 0.5) {
                const barWidth = 20;
                const barHeight = 3;
                ctx.fillStyle = '#2c3e50';
                ctx.fillRect(coin.x - barWidth/2, coin.y - 20, barWidth, barHeight);
                ctx.fillStyle = timePercent < 0.3 ? '#e74c3c' : '#f39c12';
                ctx.fillRect(coin.x - barWidth/2, coin.y - 20, timePercent * barWidth, barHeight);
            }
            
            ctx.globalAlpha = 1; // Resetar alpha
        });
    }
    
    // Desenhar animações de ataque (soco e torres)
    const now = Date.now();
    attacks.forEach(attack => {
        // Ataques de torre têm animação diferente
        if (attack.towerId) {
            renderTowerAttack(attack, now, ctx);
            return;
        }
        
        // Se o jogador está usando sprite de ataque, esconder animação antiga de soco
        if (attack.playerId && player && attack.playerId === player.id) {
            const timeSincePlayerAttack = now - playerLastAttackTime;
            if (timeSincePlayerAttack < 500 && spriteManager && spriteManager.loaded) {
                // Jogador está usando sprite de ataque, não mostrar animação antiga
                return;
            }
        }
        
        const age = now - attack.timestamp;
        const maxAge = 300; // Duração da animação (mais rápida)
        const progress = age / maxAge;
        const alpha = 1 - progress;
        
        if (progress >= 1) return;
        
        // Encontrar direção do ataque
        const attacker = gameState.players.find(p => p.id === attack.playerId);
        let angle = 0;
        
        // Se o ataque tem direção salva, usar ela
        if (attack.direction && (attack.direction.x !== 0 || attack.direction.y !== 0)) {
            angle = Math.atan2(attack.direction.y, attack.direction.x);
        } else if (attacker) {
            // Fallback: calcular direção baseada na posição do jogador
            const dx = attack.x - attacker.position.x;
            const dy = attack.y - attacker.position.y;
            // Se não há movimento, usar direção padrão (direita)
            if (dx === 0 && dy === 0) {
                angle = 0; // Direita
            } else {
                angle = Math.atan2(dy, dx);
            }
        }
        
        // Animação de soco - apenas na direção do movimento
        ctx.save();
        ctx.translate(attack.x, attack.y);
        ctx.rotate(angle);
        
        // Cor diferente para super golpe
        const isSpecial = attack.isSpecial || false;
        const attackColor = isSpecial
            ? `rgba(255, 215, 0, ${alpha})` // Dourado para super golpe
            : (attack.team === 'left' 
                ? `rgba(52, 152, 219, ${alpha})` 
                : `rgba(231, 76, 60, ${alpha})`);
        
        // Distância e tamanho maiores para super golpe
        const punchDistance = isSpecial 
            ? 30 + (progress * 30) // Super golpe: 30px até 60px
            : 20 + (progress * 20); // Normal: 20px até 40px
        const punchSize = isSpecial
            ? 12 - (progress * 3) // Super golpe maior
            : 8 - (progress * 2); // Normal
        
        const punchColor = attackColor;
        
        // Desenhar punho (círculo) - apenas na direção positiva (frente)
        ctx.fillStyle = punchColor;
        ctx.beginPath();
        ctx.arc(punchDistance, 0, punchSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Borda do punho
        ctx.strokeStyle = attack.team === 'left' 
            ? `rgba(41, 128, 185, ${alpha})` 
            : `rgba(192, 57, 43, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Efeito de impacto (círculo maior no final, mais intenso para super golpe)
        if (progress > 0.5) {
            const impactSize = isSpecial 
                ? (progress - 0.5) * 15 // Super golpe: impacto maior
                : (progress - 0.5) * 8; // Normal
            ctx.fillStyle = isSpecial
                ? `rgba(255, 215, 0, ${alpha * 0.4})` // Dourado para super golpe
                : (attack.team === 'left'
                    ? `rgba(52, 152, 219, ${alpha * 0.3})`
                    : `rgba(231, 76, 60, ${alpha * 0.3})`);
            ctx.beginPath();
            ctx.arc(punchDistance, 0, punchSize + impactSize, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Efeito especial para super golpe (raio de energia)
        if (isSpecial) {
            ctx.strokeStyle = `rgba(255, 215, 0, ${alpha * 0.6})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, punchDistance + 20, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        // Linha de movimento (rastro do soco) - apenas na direção positiva (frente)
        ctx.strokeStyle = punchColor;
        ctx.lineWidth = isSpecial ? 4 : 3; // Mais grosso para super golpe
        ctx.lineCap = 'round';
        ctx.beginPath();
        // Começar do centro e ir até o punho (só para frente)
        ctx.moveTo(0, 0);
        ctx.lineTo(punchDistance, 0);
        ctx.stroke();
        
        ctx.restore();
    });
    
    // Função para renderizar ataques de torre
    function renderTowerAttack(attack, now, ctx) {
        const age = now - attack.timestamp;
        const maxAge = 500; // Duração da animação do ataque da torre
        const progress = age / maxAge;
        const alpha = 1 - progress;
        
        if (progress >= 1) return;
        
        // Calcular posição atual do projétil (linha reta da torre ao alvo)
        const startX = attack.x;
        const startY = attack.y;
        const endX = attack.targetX;
        const endY = attack.targetY;
        
        // Posição do projétil baseada no progresso
        const projX = startX + (endX - startX) * progress;
        const projY = startY + (endY - startY) * progress;
        
        // Desenhar projétil (raio de energia)
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Cor baseada no time da torre
        const projColor = attack.team === 'left' 
            ? `rgba(52, 152, 219, ${alpha})` 
            : `rgba(231, 76, 60, ${alpha})`;
        
        // Círculo do projétil
        ctx.fillStyle = projColor;
        ctx.beginPath();
        ctx.arc(projX, projY, 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Borda brilhante
        ctx.strokeStyle = attack.team === 'left'
            ? `rgba(41, 128, 185, ${alpha})`
            : `rgba(192, 57, 43, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Efeito de rastro
        if (progress > 0.1) {
            const distance = Math.hypot(endX - startX, endY - startY);
            if (distance > 0) {
                const trailLength = 30;
                const trailStartX = projX - (endX - startX) * (trailLength / distance);
                const trailStartY = projY - (endY - startY) * (trailLength / distance);
                
                const gradient = ctx.createLinearGradient(trailStartX, trailStartY, projX, projY);
                gradient.addColorStop(0, `rgba(255, 255, 255, 0)`);
                gradient.addColorStop(1, projColor);
                
                ctx.strokeStyle = gradient;
                ctx.lineWidth = 4;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(trailStartX, trailStartY);
                ctx.lineTo(projX, projY);
                ctx.stroke();
            }
        }
        
        // Efeito de impacto quando chega no alvo
        if (progress > 0.9) {
            const impactSize = (progress - 0.9) * 30;
            ctx.fillStyle = attack.team === 'left'
                ? `rgba(52, 152, 219, ${alpha * 0.5})`
                : `rgba(231, 76, 60, ${alpha * 0.5})`;
            ctx.beginPath();
            ctx.arc(endX, endY, impactSize, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    }
    
    // Desenhar floating damage texts (do servidor e locais)
    const allDamageTexts = [...(gameState.damageTexts || []), ...damageTexts];
    if (allDamageTexts.length > 0) {
        const now = Date.now();
        allDamageTexts.forEach(damageText => {
            const age = now - damageText.timestamp;
            const maxAge = 1000; // 1 segundo
            const progress = age / maxAge;
            
            if (progress >= 1) return;
            
            // Posição flutuante (sobe e desaparece)
            const offsetY = -30 * progress;
            const alpha = 1 - progress;
            
            // Cor baseada no tipo de ataque
            const textColor = damageText.isSpecial 
                ? `rgba(255, 215, 0, ${alpha})` // Dourado para super golpe
                : `rgba(255, 255, 255, ${alpha})`; // Branco para golpe normal
            
            // Tamanho maior para super golpe
            const fontSize = damageText.isSpecial ? 20 : 14;
            
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = textColor;
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.strokeStyle = '#2c3e50';
            ctx.lineWidth = 3;
            ctx.strokeText(`-${damageText.value}`, damageText.x, damageText.y + offsetY);
            ctx.fillText(`-${damageText.value}`, damageText.x, damageText.y + offsetY);
            ctx.restore();
        });
    }
    
    // Renderizar informações do jogador no canvas (canto superior esquerdo)
    if (player) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        const infoWidth = 180;
        const infoHeight = 85;
        ctx.fillRect(10, 10, infoWidth, infoHeight);
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 2;
        ctx.strokeRect(10, 10, infoWidth, infoHeight);
        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`👤 ${player.username}`, 20, 28);
        
        ctx.fillStyle = '#2ecc71';
        ctx.font = '11px Arial';
        ctx.fillText(`HP: ${player.health}/${player.maxHealth}`, 20, 45);
        
        ctx.fillStyle = '#f1c40f';
        ctx.fillText(`💰 ${player.coins || 0}`, 20, 62);
        
        if (gameState && gameState.towers) {
            const playerTowers = gameState.towers.filter(t => t.team === player.team);
            const maxLevel = playerTowers.length > 0 ? Math.max(...playerTowers.map(t => t.upgradeLevel || 0)) : 0;
            ctx.fillStyle = maxLevel > 0 ? '#2ecc71' : '#3498db';
            ctx.fillText(`🏰 Nv.${maxLevel}`, 20, 79);
        }
        
        ctx.restore();
    }
    
    // Renderizar informações de round no canvas (canto superior direito)
    if (gameState) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        const roundInfoWidth = 170;
        const roundInfoHeight = 50;
        ctx.fillRect(canvas.width - roundInfoWidth - 10, 10, roundInfoWidth, roundInfoHeight);
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 2;
        ctx.strokeRect(canvas.width - roundInfoWidth - 10, 10, roundInfoWidth, roundInfoHeight);
        
        ctx.fillStyle = '#3498db';
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'left';
        if (gameState.currentRound && gameState.maxRounds) {
            ctx.fillText(`Round ${gameState.currentRound}/${gameState.maxRounds}`, canvas.width - roundInfoWidth, 28);
        }
        
        ctx.fillStyle = '#95a5a6';
        ctx.font = '10px Arial';
        if (gameState.roundWins) {
            ctx.fillText(`LEFT ${gameState.roundWins.left || 0} x ${gameState.roundWins.right || 0} RIGHT`, canvas.width - roundInfoWidth, 45);
        }
        
        ctx.restore();
    }
    
    // Renderizar comandos táticos no canvas (canto inferior) - APENAS DESKTOP
    // No mobile, usar barra HTML fixa
    const isMobile = window.innerWidth <= 768;
    if (gameState && gameState.status === 'in_game' && player && !isMobile) {
        ctx.save();
        const commandsWidth = 800;
        const commandsHeight = 120;
        const commandsX = (canvas.width - commandsWidth) / 2;
        const commandsY = canvas.height - commandsHeight - 10;
        
        // Fundo semi-transparente
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(commandsX, commandsY, commandsWidth, commandsHeight);
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 3;
        ctx.strokeRect(commandsX, commandsY, commandsWidth, commandsHeight);
        
        // Título
        ctx.fillStyle = '#f1c40f';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('🎯 Comandos Táticos', commandsX + commandsWidth / 2, commandsY + 20);
        
        // Botões de comando (ajustados para 7 comandos)
        const buttonWidth = 90;
        const buttonHeight = 45;
        const buttonGap = 8;
        const numCommands = 7;
        const startX = commandsX + (commandsWidth - (buttonWidth * numCommands + buttonGap * (numCommands - 1))) / 2;
        const startY = commandsY + 35;
        
        // Armazenar posições dos botões para detecção de clique
        if (!window.tacticalButtons) window.tacticalButtons = [];
        window.tacticalButtons = [];
        
        const commands = [
            { text: '⬆️ Avançar', color: '#2ecc71', cmd: 'advance' },
            { text: '⏸️ Segurar', color: '#f39c12', cmd: 'hold' },
            { text: '⬇️ Recuar', color: '#e74c3c', cmd: 'retreat' },
            { text: '🛑 Parar', color: '#95a5a6', cmd: 'stop' },
            { text: '🛡️ Defender', color: '#16a085', cmd: 'defend' },
            { text: '🎯 Focar', color: '#9b59b6', cmd: 'focus' },
            { text: '🛡️ Proteger', color: '#3498db', cmd: 'protect' }
        ];
        
        commands.forEach((cmd, index) => {
            const btnX = startX + index * (buttonWidth + buttonGap);
            const btnY = startY;
            
            // Armazenar posição do botão
            window.tacticalButtons.push({
                x: btnX,
                y: btnY,
                width: buttonWidth,
                height: buttonHeight,
                command: cmd.cmd
            });
            
            // Verificar se é o comando ativo
            const isActive = player.tacticalCommand === cmd.cmd;
            
            // Fundo do botão
            ctx.fillStyle = isActive ? cmd.color : 'rgba(52, 73, 94, 0.9)';
            ctx.fillRect(btnX, btnY, buttonWidth, buttonHeight);
            
            // Borda
            ctx.strokeStyle = isActive ? '#f1c40f' : '#7f8c8d';
            ctx.lineWidth = isActive ? 3 : 1;
            ctx.strokeRect(btnX, btnY, buttonWidth, buttonHeight);
            
            // Texto (ajustado para botões menores)
            ctx.fillStyle = 'white';
            ctx.font = 'bold 11px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(cmd.text, btnX + buttonWidth / 2, btnY + buttonHeight / 2 + 3);
        });
        
        ctx.restore();
    }
}

// Handler para cliques nos comandos táticos no canvas
function handleTacticalCommandClick(event) {
    if (!gameState || gameState.status !== 'in_game' || !player) {
        return false;
    }
    
    if (!window.tacticalButtons || window.tacticalButtons.length === 0) {
        return false;
    }
    
    const rect = canvas.getBoundingClientRect();
    // Calcular coordenadas considerando o escalonamento do canvas
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    
    // Verificar se clicou em algum botão
    for (const button of window.tacticalButtons) {
        if (x >= button.x && x <= button.x + button.width &&
            y >= button.y && y <= button.y + button.height) {
            sendTacticalCommand(button.command);
            return true; // Indica que o clique foi tratado
        }
    }
    
    return false; // Clique não foi nos comandos
}


// Funções para gerenciar modal do jogo
function openGameMenu() {
    const modal = document.getElementById('game-menu-modal');
    const menuBody = document.getElementById('menu-body');
    const menuTitle = document.getElementById('menu-title');
    
    if (!modal || !menuBody) return;
    
    // Determinar qual conteúdo mostrar baseado no estado do jogo
    if (!gameState || !gameStarted) {
        // Menu inicial - mostrar botão para criar lobby
        menuTitle.textContent = '🎮 Menu do Jogo';
        menuBody.innerHTML = `
            <button onclick="createLobby();" style="width: 100%; padding: 15px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; margin-bottom: 10px;">
                🎮 Criar uma Sala
            </button>
            <div style="margin: 15px 0; text-align: center; color: #95a5a6; font-size: 14px;">ou</div>
            <div style="margin-bottom: 15px;">
                <input type="text" id="join-lobby-input" placeholder="Digite o ID da sala (4 dígitos)" maxlength="4" pattern="[0-9]{4}" inputmode="numeric" style="width: 100%; padding: 12px; font-size: 18px; text-align: center; border: 2px solid #7f8c8d; border-radius: 8px; background: rgba(255,255,255,0.1); color: white; margin-bottom: 10px; letter-spacing: 4px; font-weight: bold;" onkeypress="if(event.key === 'Enter') joinLobby();" oninput="this.value = this.value.replace(/[^0-9]/g, '').slice(0, 4);">
                <button onclick="joinLobby();" style="width: 100%; padding: 15px; background: #2ecc71; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold;">
                    🚪 Entrar na Sala
                </button>
                <p style="font-size: 11px; color: #95a5a6; text-align: center; margin-top: 8px;">Exemplo: 1234</p>
            </div>
            <div id="lobby-info-container" style="display: none;">
                <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <h3 style="color: #f1c40f; margin-bottom: 10px;">⏳ Aguardando Jogadores</h3>
                    <p style="color: #ecf0f1; margin-bottom: 10px;"><strong>Jogadores na sala:</strong> <span id="lobby-players">1/2</span></p>
                    <p id="waiting-message" style="color: #e67e22; margin-bottom: 10px;">Aguardando outro jogador...</p>
                    <p style="color: #95a5a6; font-size: 13px; margin-bottom: 10px;">Jogadores prontos: <span id="ready-count">0</span>/<span id="total-players">1</span></p>
                    <button id="ready-btn-lobby" onclick="setReady();" style="width: 100%; padding: 12px; background: #2ecc71; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; margin-bottom: 10px;">
                        ✅ Estou Pronto!
                    </button>
                    <p style="font-size: 13px; color: #7f8c8d; text-align: center; margin-top: 10px;">
                        <strong style="color: #f1c40f;">ID da Sala:</strong> <span id="lobby-id" style="font-size: 18px; font-weight: bold; color: #2ecc71; letter-spacing: 2px;">----</span> 
                        <button onclick="copyLobbyId()" style="margin-left: 8px; padding: 5px 12px; font-size: 11px; background: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer;">📋 Copiar</button>
                    </p>
                </div>
            </div>
        `;
        
        // Verificar se já existe um lobby ativo
        if (window.currentLobby) {
            const lobbyInfoContainer = document.getElementById('lobby-info-container');
            if (lobbyInfoContainer) {
                lobbyInfoContainer.style.display = 'block';
                const lobbyIdEl = document.getElementById('lobby-id');
                const lobbyPlayersEl = document.getElementById('lobby-players');
                const totalPlayersEl = document.getElementById('total-players');
                if (lobbyIdEl && window.currentLobby.id) lobbyIdEl.textContent = window.currentLobby.id;
                if (lobbyPlayersEl && window.currentLobby.players) lobbyPlayersEl.textContent = `${window.currentLobby.players.length}/2`;
                if (totalPlayersEl && window.currentLobby.players) totalPlayersEl.textContent = window.currentLobby.players.length;
            }
        }
    } else if (gameState && gameState.status === 'preparing') {
        // Fase de preparação
        menuTitle.textContent = '⚔️ Fase de Preparação';
        menuBody.innerHTML = `
            <div style="margin-bottom: 15px;">
                <div id="round-info" style="color: #3498db; font-weight: bold; margin-bottom: 10px; font-size: 16px;">Round 1/3</div>
                <div id="round-score" style="color: #95a5a6; margin-bottom: 15px; font-size: 14px;">Placar: LEFT 0 x 0 RIGHT</div>
            </div>
            
            <button onclick="openShopModal(); closeGameMenu();" style="width: 100%; padding: 15px; background: #f1c40f; color: #1a1a2e; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; margin-bottom: 15px;">
                🏪 Abrir Loja
            </button>
            
            <div id="ready-status" style="color: #95a5a6; margin-bottom: 15px; font-size: 14px; line-height: 1.5;">
                Clique em "Estou Pronto!" quando terminar de posicionar suas tropas (ou quando quiser começar sem posicionar todas).
            </div>
            
            <button id="ready-btn" onclick="setPlayerReady(); closeGameMenu();" style="width: 100%; padding: 15px; background: #2ecc71; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold;">
                ▶ Estou Pronto!
            </button>
        `;
        updateRoundInfo();
        updateInventory();
    } else if (gameState && gameState.status === 'in_game') {
        // Jogo em andamento - mostrar comandos táticos
        menuTitle.textContent = '🎯 Comandos Táticos';
        menuBody.innerHTML = `
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px;">
                <button id="cmd-advance" onclick="sendTacticalCommand('advance')" style="flex: 1; min-width: calc(50% - 5px); padding: 12px; background: #2ecc71; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; min-height: 50px;">
                    ⬆️ Avançar
                </button>
                <button id="cmd-hold" onclick="sendTacticalCommand('hold')" style="flex: 1; min-width: calc(50% - 5px); padding: 12px; background: #f39c12; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; min-height: 50px;">
                    ⏸️ Segurar
                </button>
                <button id="cmd-retreat" onclick="sendTacticalCommand('retreat')" style="flex: 1; min-width: calc(50% - 5px); padding: 12px; background: #e74c3c; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; min-height: 50px;">
                    ⬇️ Recuar
                </button>
                <button id="cmd-focus" onclick="sendTacticalCommand('focus')" style="flex: 1; min-width: calc(50% - 5px); padding: 12px; background: #9b59b6; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; min-height: 50px;">
                    🎯 Focar Alvo
                </button>
                <button id="cmd-protect" onclick="sendTacticalCommand('protect')" style="flex: 1; min-width: 100%; padding: 12px; background: #3498db; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; min-height: 50px;">
                    🛡️ Proteger Arqueiros
                </button>
            </div>
            <div id="tactical-status" style="color: #95a5a6; font-size: 14px; text-align: center; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 5px;">
                Comando atual: Nenhum
            </div>
        `;
    }
    
    modal.style.display = 'block';
    
    // Se não houver jogo ativo, garantir que o modal fique sempre aberto
    if (!gameState || !gameStarted) {
        // Não permitir fechar o modal quando não há jogo
        const closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.style.display = 'none';
        }
    } else {
        // Permitir fechar quando há jogo ativo
        const closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.style.display = 'flex';
        }
    }
}

function closeGameMenu() {
    // Não fechar o modal se não houver jogo ativo (sempre aberto)
    if (!gameState || !gameStarted) {
        return;
    }
    
    const modal = document.getElementById('game-menu-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Fechar modal ao clicar fora (apenas se houver jogo ativo)
document.addEventListener('click', (e) => {
    const modal = document.getElementById('game-menu-modal');
    if (modal && modal.style.display === 'block' && (gameState && gameStarted)) {
        const modalContent = modal.querySelector('.game-menu-content');
        if (modalContent && !modalContent.contains(e.target) && !e.target.closest('#menu-btn')) {
            closeGameMenu();
        }
    }
});

// Função para atualizar informações de round no modal
function updateRoundInfo() {
    if (!gameState) return;
    
    const roundInfo = document.getElementById('round-info');
    const roundScore = document.getElementById('round-score');
    
    if (roundInfo && gameState.currentRound && gameState.maxRounds) {
        roundInfo.textContent = `Round ${gameState.currentRound}/${gameState.maxRounds}`;
    }
    
    if (roundScore && gameState.roundWins) {
        roundScore.textContent = `Placar: LEFT ${gameState.roundWins.left || 0} x ${gameState.roundWins.right || 0} RIGHT`;
    }
}

// Garantir que o menu está acessível quando a página carrega
window.addEventListener('DOMContentLoaded', () => {
    // Mostrar botão de menu imediatamente
    const menuBtn = document.getElementById('menu-btn');
    if (menuBtn) {
        menuBtn.style.display = 'block';
    }
    
    // Abrir menu automaticamente se não houver jogo ativo (sempre aberto)
    setTimeout(() => {
        if (!gameState || !gameStarted) {
            openGameMenu();
            // Manter modal sempre aberto quando não há jogo
            const modal = document.getElementById('game-menu-modal');
            if (modal) {
                modal.style.display = 'block';
            }
        }
    }, 500);
});

// Configurar listeners do socket quando disponível
function setupSocketListeners() {
    console.log('🔧 Tentando configurar listeners do socket...');
    console.log('   window.socket existe?', !!window.socket);
    console.log('   window.socket conectado?', window.socket?.connected);
    
    if (window.socket && !window.socketListenersSetup) {
        console.log('✅ Configurando listeners do socket...');
        // Fase de preparação iniciada - mostrar campo de batalha imediatamente
        window.socket.on('game_preparation_started', (data) => {
            console.log('🎮 Fase de preparação iniciada! Mostrando campo de batalha...', data);
            
            // Parar qualquer renderização de lobby
            if (window.stopLobbyRoom) {
                window.stopLobbyRoom();
            }
            
            // Esconder informações do lobby
            const lobbyInfo = document.getElementById('lobby-info');
            if (lobbyInfo) lobbyInfo.style.display = 'none';
            
            gameState = data.gameState;
            if (gameState) {
                gameState.status = 'preparing'; // Garantir que o status está definido
                console.log('✅ Status definido como "preparing"');
            }
            gameStarted = true;
            
            const currentUser = window.currentUser();
            player = gameState.players.find(p => p.id === currentUser.id);
            
            if (!player) {
                console.error('❌ Jogador não encontrado no estado do jogo');
                return;
            }
            
            // Mostrar barra superior de controles
            const topControlsBar = document.getElementById('top-controls-bar');
            if (topControlsBar) topControlsBar.style.display = 'flex';
            
            // Mostrar botões de controle
            const menuBtn = document.getElementById('menu-btn');
            const shopBtn = document.getElementById('shop-btn');
            const readyBtnTop = document.getElementById('ready-btn-top');
            if (menuBtn) menuBtn.style.display = 'flex'; // Mostrar menu
            if (shopBtn) shopBtn.style.display = 'flex'; // Mostrar loja
            if (readyBtnTop) {
                readyBtnTop.style.display = 'block'; // Mostrar botão pronto
                // Reabilitar botão pronto se estiver desabilitado
                readyBtnTop.disabled = false;
                readyBtnTop.textContent = '▶ Estou Pronto!';
                readyBtnTop.style.background = '#2ecc71';
                readyBtnTop.style.cursor = 'pointer';
            }
            
            // Atualizar inventário para aparecer abaixo do canvas
            updateInventory();
            
            // Abrir modal de preparação automaticamente
            setTimeout(() => {
                openGameMenu();
            }, 500);
            
            // Adicionar listeners para drag and drop no canvas
            canvas.addEventListener('mouseup', handleCanvasDrop);
            canvas.addEventListener('click', handleCanvasClickForPlacement);
            canvas.addEventListener('touchend', (e) => {
                e.preventDefault();
                handleCanvasDrop(e);
            }, { passive: false });
            
            // Iniciar loop do jogo para renderizar o campo de batalha
            if (!window.gameLoopRunning) {
                window.gameLoopRunning = true;
                gameLoop();
            }
        });
        
        // Atualização de status de prontidão
        window.socket.on('player_ready_update', (data) => {
            const readyCount = document.getElementById('ready-count');
            const totalPlayers = document.getElementById('total-players');
            if (readyCount) readyCount.textContent = data.readyCount;
            if (totalPlayers) totalPlayers.textContent = data.totalPlayers;
        });
        
        // Jogo iniciado (guerra começou)
        window.socket.on('game_started', (data) => {
            console.log('⚔️ GUERRA INICIADA!', data);
            console.log(`   Minions no estado inicial: ${data.gameState?.minions?.length || 0}`);
            if (data.gameState?.minions && data.gameState.minions.length > 0) {
                console.log(`   Primeiros minions:`, data.gameState.minions.slice(0, 3).map(m => ({id: m.id, x: m.x, y: m.y, team: m.team})));
            }
            gameState = data.gameState;
            
            const currentUser = window.currentUser();
            player = gameState.players.find(p => p.id === currentUser.id);
            
            // Inicializar posição anterior para detecção de movimento
            if (player) {
                playerLastPosition = { x: player.position.x, y: player.position.y };
                playerLastMoveTime = Date.now();
            }
            
            // Esconder botões de preparação durante o jogo
            const readyBtnTop = document.getElementById('ready-btn-top');
            if (readyBtnTop) readyBtnTop.style.display = 'none'; // Esconder botão pronto durante jogo
            
            // Mostrar/esconder barra de comandos táticos (mobile)
            const tacticalBar = document.getElementById('tactical-commands-bar');
            const isMobile = window.innerWidth <= 768;
            if (tacticalBar) {
                tacticalBar.style.display = isMobile ? 'block' : 'none';
            }
            
            // Fechar modal de loja se estiver aberto
            closeShopModal();
            
            // Adicionar listener para seleção de alvo e comandos táticos
            // Remover listener anterior se existir para evitar duplicatas
            canvas.removeEventListener('click', handleCanvasClickForPlacement);
            canvas.removeEventListener('touchend', handleCanvasClickForPlacement);
            canvas.addEventListener('click', handleCanvasClickForPlacement);
            canvas.addEventListener('touchend', (e) => {
                e.preventDefault();
                handleCanvasClickForPlacement(e);
            }, { passive: false });
            console.log('✅ Listener de clique adicionado ao canvas para comandos táticos');
        });
        
        window.socket.on('player_moved', (data) => {
            if (!gameState) return;
            
            const otherPlayer = gameState.players.find(p => p.id === data.playerId);
            if (otherPlayer) {
                otherPlayer.position = data.position;
            }
        });
        
        // Listener para erro de comando tático (cooldown)
        window.socket.on('tactical_command_error', (data) => {
            console.log('❌ Erro no comando tático:', data.message);
            // Resetar cooldown se houver erro do servidor
            resetTacticalCooldown();
        });
        
        window.socket.on('spawn_error', (data) => {
            console.log('❌ Erro ao spawnar inimigos:', data.message);
            alert(`Erro: ${data.message}`);
        });
        
        window.socket.on('arrow_error', (data) => {
            console.log('❌ Erro ao usar flecha especial:', data.message);
            alert(`Erro: ${data.message}`);
        });
        
        window.socket.on('player_attacked', (data) => {
            console.log('📥 Recebido player_attacked do servidor:', data);
            
            // Adicionar animação de ataque
            if (data.attack) {
                attacks.push(data.attack);
                console.log(`✅ Animação de ataque adicionada: ${data.attack.id}`);
            }
            
            // Atualizar estado do jogo
            if (data.gameState) {
                const oldTowerHealth = gameState?.towers?.map(t => ({id: t.id, health: t.health})) || [];
                
                gameState = data.gameState;
                
                // Verificar mudanças nas torres
                if (gameState.towers) {
                    gameState.towers.forEach(tower => {
                        const oldTower = oldTowerHealth.find(t => t.id === tower.id);
                        if (oldTower && oldTower.health !== tower.health) {
                            console.log(`🎯 TORRE ATINGIDA! ${tower.id} HP: ${oldTower.health} → ${tower.health}`);
                        }
                    });
                }
                
                // Atualizar referência do player
                const currentUser = window.currentUser();
                if (currentUser) {
                    player = gameState.players.find(p => p.id === currentUser.id);
                }
            }
        });
        
        window.socket.on('game_state_update', (data) => {
            if (data.gameState) {
                // Log para debug quando minions são adicionados
                if (data.gameState.minions && data.gameState.minions.length > 0) {
                    const oldMinionCount = gameState && gameState.minions ? gameState.minions.length : 0;
                    const newMinionCount = data.gameState.minions.length;
                    if (newMinionCount > oldMinionCount) {
                        console.log(`🎯 ${newMinionCount - oldMinionCount} novo(s) minion(s) recebido(s) do servidor. Total: ${newMinionCount}`);
                        data.gameState.minions.slice(oldMinionCount).forEach(m => {
                            console.log(`   - Minion ${m.id} em (${m.x.toFixed(0)}, ${m.y.toFixed(0)}), time: ${m.team}, tipo: ${m.type}`);
                        });
                    }
                }
                
                // Verificar se tropas foram posicionadas
                const hadUnplacedTroops = player && player.troops ? player.troops.filter(t => !t.placed).length > 0 : false;
                
                // Preservar ataques locais
                const oldAttacks = attacks.filter(a => Date.now() - a.timestamp < 400);
                
                // Preservar flechas locais (feedback visual imediato)
                const now = Date.now();
                const localArrows = gameState && gameState.projectiles 
                    ? gameState.projectiles.filter(p => p.isLocal && (now - p.timestamp) < 2000)
                    : [];
                
                const oldTowerHealth = gameState?.towers?.map(t => ({id: t.id, health: t.health})) || [];
                
                // Preservar posição local do jogador se estiver se movendo
                const currentUser = window.currentUser();
                let localPlayerPosition = null;
                if (currentUser && player) {
                    localPlayerPosition = { x: player.position.x, y: player.position.y };
                }
                
                // Atualizar damage texts
                if (data.gameState.damageTexts) {
                    data.gameState.damageTexts.forEach(text => {
                        if (!damageTexts.find(t => t.id === text.id)) {
                            damageTexts.push(text);
                        }
                    });
                }
                
                gameState = data.gameState;
                
                // Mesclar flechas locais com as do servidor
                if (!gameState.projectiles) gameState.projectiles = [];
                if (localArrows.length > 0) {
                    // Remover flechas locais duplicadas que já foram recebidas do servidor
                    const serverArrowIds = gameState.projectiles.map(p => p.id);
                    const uniqueLocalArrows = localArrows.filter(la => !serverArrowIds.includes(la.id));
                    gameState.projectiles = [...gameState.projectiles, ...uniqueLocalArrows];
                    console.log(`🏹 Mesclando ${uniqueLocalArrows.length} flechas locais com ${gameState.projectiles.length - uniqueLocalArrows.length} do servidor`);
                }
                
                // Verificar mudanças nas torres
                if (gameState.towers) {
                    gameState.towers.forEach(tower => {
                        const oldTower = oldTowerHealth.find(t => t.id === tower.id);
                        if (oldTower && oldTower.health !== tower.health) {
                            console.log(`📊 Torre ${tower.id} HP mudou: ${oldTower.health} → ${tower.health}`);
                        }
                    });
                }
                
                // Adicionar ataques do servidor
                if (gameState.attacks) {
                    gameState.attacks.forEach(serverAttack => {
                        if (!attacks.find(a => a.id === serverAttack.id)) {
                            attacks.push(serverAttack);
                        }
                    });
                }
                
                // Manter ataques locais
                attacks = [...oldAttacks, ...attacks.filter(a => !oldAttacks.includes(a))];
                
                // Atualizar referência do player
                if (currentUser) {
                    const oldPlayer = player;
                    const serverPlayer = gameState.players.find(p => p.id === currentUser.id);
                    if (serverPlayer) {
                        player = serverPlayer;
                        // Se o jogador estava se movendo localmente, preservar a posição local
                        // (o servidor vai sincronizar na próxima atualização)
                        if (localPlayerPosition && (keys['w'] || keys['s'] || keys['a'] || keys['d'] || 
                            keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'])) {
                            // Manter posição local durante movimento
                            player.position.x = localPlayerPosition.x;
                            player.position.y = localPlayerPosition.y;
                        }
                        
                        // Atualizar UI dos botões táticos (mobile)
                        if (player.tacticalCommand) {
                            updateTacticalButtonsUI(player.tacticalCommand);
                        } else {
                            updateTacticalButtonsUI(null);
                        }
                        
                        // Verificar se tropas foram posicionadas e abrir modal automaticamente
                        if (player && player.troops) {
                            const oldUnplacedCount = oldPlayer && oldPlayer.troops ? oldPlayer.troops.filter(t => !t.placed).length : 0;
                            const newUnplacedCount = player.troops.filter(t => !t.placed).length;
                            
                            // Atualizar inventário
                            updateInventory();
                            
                            // Atualizar informações de round e inventário no modal
                            updateRoundInfo();
                            
                            // Se o modal estiver aberto, atualizar o conteúdo
                            const menuModal = document.getElementById('game-menu-modal');
                            if (menuModal && menuModal.style.display === 'block' && gameState.status === 'preparing') {
                            const readyStatus = document.getElementById('ready-status');
                                if (readyStatus) {
                                if (newUnplacedCount > 0) {
                                    readyStatus.innerHTML = `<span style="font-size: 1.1em;">${newUnplacedCount} tropa(s) ainda não posicionada(s). Você pode começar sem posicionar todas.</span>`;
                                    readyStatus.style.color = '#e67e22';
                                } else {
                                    readyStatus.innerHTML = '<span style="color: #2ecc71; font-size: 1.2em; font-weight: bold;">✅ Todas as tropas posicionadas! Clique em "Estou Pronto!" quando terminar.</span>';
                                }
                            }
                            }
                        }
                    }
                }
            }
        });
        
        window.socket.on('round_end', (data) => {
            console.log('🏆 Round finalizado!', data);
            const currentUser = window.currentUser();
            const isRoundWinner = data.roundWinner === player?.team;
            
            // Mostrar resultado do round
            const message = isRoundWinner 
                ? `🎉 Você venceu o Round ${data.roundNumber}! +100 moedas!`
                : `😢 Você perdeu o Round ${data.roundNumber}. +50 moedas.`;
            
            alert(message);
            
            // Atualizar gameState
            if (data.gameState) {
                gameState = data.gameState;
                player = gameState.players.find(p => p.id === currentUser.id);
            }
            
            // Reabilitar botão PRONTO para o próximo round
            const readyBtn = document.getElementById('ready-btn');
            if (readyBtn) {
                readyBtn.disabled = false;
                readyBtn.textContent = '▶ Estou Pronto!';
                readyBtn.style.background = '#2ecc71';
            }
            
            // Atualizar informações de round
            updateRoundInfo();
        });
        
        window.socket.on('game_over', (data) => {
            const currentUser = window.currentUser();
            const isWinner = data.winner === player?.team;
            
            // Mostrar tela de vitória/derrota final
            const finalMessage = isWinner 
                ? `🎉🎉🎉 VOCÊ VENCEU A PARTIDA! 🎉🎉🎉\n\nPlacar Final:\nLEFT ${data.finalScore?.left || 0} x ${data.finalScore?.right || 0} RIGHT`
                : `😢 Você perdeu a partida.\n\nPlacar Final:\nLEFT ${data.finalScore?.left || 0} x ${data.finalScore?.right || 0} RIGHT`;
            
            setTimeout(() => {
                alert(finalMessage);
            }, 500);
        });
        
        window.socketListenersSetup = true;
    }
}

// Controles touch removidos - usar teclado/touch nativo do navegador

// Variável para armazenar o alvo selecionado para focar
let focusTarget = null;
let isSelectingTarget = false;

// Função para enviar comandos táticos
// Debounce para comandos táticos (prevenir spam)
let lastTacticalCommandTime = 0;
const TACTICAL_COMMAND_COOLDOWN = 200; // 200ms entre comandos

let tacticalCommandCooldown = 0; // Cooldown em segundos
let tacticalCooldownInterval = null; // Interval para atualizar cooldown

// Função para iniciar cooldown dos comandos táticos
function startTacticalCooldown() {
    // Limpar interval anterior se existir
    if (tacticalCooldownInterval) {
        clearInterval(tacticalCooldownInterval);
        tacticalCooldownInterval = null;
    }
    
    // Iniciar cooldown de 5 segundos
    tacticalCommandCooldown = 5;
    updateTacticalButtonsCooldown();
    
    // Atualizar cooldown a cada segundo
    tacticalCooldownInterval = setInterval(() => {
        if (tacticalCommandCooldown > 0) {
            tacticalCommandCooldown--;
            updateTacticalButtonsCooldown();
        } else {
            clearInterval(tacticalCooldownInterval);
            tacticalCooldownInterval = null;
        }
    }, 1000);
}

// Função para resetar cooldown (quando servidor rejeitar)
function resetTacticalCooldown() {
    tacticalCommandCooldown = 0;
    if (tacticalCooldownInterval) {
        clearInterval(tacticalCooldownInterval);
        tacticalCooldownInterval = null;
    }
    updateTacticalButtonsCooldown();
}

// Função para atualizar estado dos botões durante cooldown
function updateTacticalButtonsCooldown() {
    const buttons = document.querySelectorAll('button[id^="cmd-"], button[onclick*="sendTacticalCommand"]');
    const maxCooldown = 5;
    const progress = tacticalCommandCooldown / maxCooldown;
    
    buttons.forEach(btn => {
        if (tacticalCommandCooldown > 0) {
            btn.disabled = true;
            btn.style.opacity = '0.6';
            btn.style.cursor = 'not-allowed';
            btn.style.position = 'relative';
            btn.style.overflow = 'hidden';
            
            // Atualizar texto
            const originalText = btn.textContent;
            if (!originalText.includes('(')) {
                btn.dataset.originalText = originalText;
            }
            btn.textContent = `${btn.dataset.originalText || originalText} (${tacticalCommandCooldown}s)`;
            
            // Adicionar barra de progresso animada
            let progressBar = btn.querySelector('.cooldown-progress-bar');
            if (!progressBar) {
                progressBar = document.createElement('div');
                progressBar.className = 'cooldown-progress-bar';
                btn.appendChild(progressBar);
            }
            
            // Atualizar largura da barra de progresso (animação suave)
            const progressPercent = (1 - progress) * 100;
            progressBar.style.cssText = `
                position: absolute;
                bottom: 0;
                left: 0;
                height: 4px;
                background: linear-gradient(90deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.6) 100%);
                width: ${progressPercent}%;
                transition: width 1s linear;
                z-index: 1;
                border-radius: 0 0 8px 8px;
                box-shadow: 0 0 5px rgba(255, 255, 255, 0.5);
            `;
            
            // Adicionar efeito de brilho pulsante
            const glowIntensity = 0.2 + (0.3 * progress);
            btn.style.boxShadow = `0 0 ${10 * progress}px rgba(255, 255, 255, ${glowIntensity}), inset 0 0 ${5 * progress}px rgba(255, 255, 255, 0.2)`;
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.style.boxShadow = '';
            
            // Remover barra de progresso
            const progressBar = btn.querySelector('.cooldown-progress-bar');
            if (progressBar) {
                progressBar.remove();
            }
            
            // Restaurar texto original
            if (btn.dataset.originalText) {
                btn.textContent = btn.dataset.originalText;
                delete btn.dataset.originalText;
            }
        }
    });
}

// Função para atualizar UI dos botões táticos (mobile)
function updateTacticalButtonsUI(activeCommand) {
    const tacticalButtons = document.querySelectorAll('.tactical-btn');
    tacticalButtons.forEach(btn => {
        const command = btn.dataset.command;
        if (command === activeCommand) {
            btn.classList.add('active');
            btn.style.opacity = '1';
            btn.style.transform = 'scale(1.1)';
        } else {
            btn.classList.remove('active');
            btn.style.opacity = '0.7';
            btn.style.transform = 'scale(1)';
        }
    });
}

function sendTacticalCommand(command) {
    if (!window.socket || !window.socket.connected || !player) {
        console.log('❌ Não é possível enviar comando tático');
        return;
    }
    
    // Verificar cooldown local (5 segundos)
    if (tacticalCommandCooldown > 0) {
        console.log(`⏳ Comando tático em cooldown! Aguarde ${tacticalCommandCooldown} segundo(s)`);
        return;
    }
    
    // Se for "focar alvo", verificar se já tem alvo selecionado
    if (command === 'focus') {
        // Se não tem alvo selecionado ainda, ativar modo de seleção
        if (!focusTarget) {
            isSelectingTarget = true;
            closeGameMenu(); // Fechar modal para permitir clicar no canvas
            const statusEl = document.getElementById('tactical-status');
            if (statusEl) {
                statusEl.textContent = '🎯 Clique no alvo que deseja focar (jogador, minion ou torre inimiga)';
                statusEl.style.color = '#f1c40f';
            }
            canvas.style.cursor = 'crosshair';
            return; // Não enviar ainda, aguardar seleção de alvo
        }
        // Se já tem alvo selecionado, continuar para enviar o comando
    }
    
    console.log(`🎯 Enviando comando tático: ${command}`);
    
    // Adicionar efeito visual imediato no botão clicado
    const clickedButton = document.getElementById(`cmd-${command}`);
    if (clickedButton) {
        clickedButton.style.transform = 'scale(0.95)';
        clickedButton.style.transition = 'transform 0.1s ease';
    setTimeout(() => {
            clickedButton.style.transform = '';
        }, 100);
    }
    
    window.socket.emit('tactical_command', { command, targetId: focusTarget });
    
    // Atualizar estado visual dos botões HTML (mobile)
    updateTacticalButtonsUI(command);
    
    // Limpar alvo após enviar e desativar modo de seleção
    focusTarget = null;
    isSelectingTarget = false;
    canvas.style.cursor = 'default';
    
    // Iniciar cooldown de 5 segundos APENAS após enviar o comando
    startTacticalCooldown();
    
    // Atualizar UI
    const statusEl = document.getElementById('tactical-status');
    if (statusEl) {
        const commandNames = {
            'advance': '⬆️ Avançar',
            'hold': '⏸️ Segurar',
            'retreat': '⬇️ Recuar',
            'focus': '🎯 Focar Alvo',
            'protect': '🛡️ Proteger Arqueiros'
        };
        statusEl.textContent = `Comando atual: ${commandNames[command] || command}`;
        statusEl.style.color = '#95a5a6';
    }
    
    // Destacar botão ativo (se estiver no modal)
    const menuBody = document.getElementById('menu-body');
    if (menuBody) {
        menuBody.querySelectorAll('button[id^="cmd-"]').forEach(btn => {
            btn.style.opacity = '0.6';
            btn.style.boxShadow = 'none';
        });
        const activeBtn = document.getElementById(`cmd-${command}`);
        if (activeBtn) {
            activeBtn.style.opacity = '1';
            activeBtn.style.boxShadow = '0 0 10px rgba(241, 196, 15, 0.8)';
        }
    }
    
    canvas.style.cursor = 'default';
}

// Adicionar listener para clicar no canvas quando estiver selecionando alvo
function handleTargetSelection(event) {
    if (!isSelectingTarget || !gameState) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Verificar se clicou em um jogador inimigo
    const enemyPlayers = gameState.players.filter(p => 
        p.team !== player.team && p.health > 0
    );
    for (const enemyPlayer of enemyPlayers) {
        const dist = Math.hypot(x - enemyPlayer.position.x, y - enemyPlayer.position.y);
        if (dist <= 25) {
            focusTarget = { type: 'player', id: enemyPlayer.id };
            sendTacticalCommand('focus');
            return;
        }
    }
    
    // Verificar se clicou em um minion inimigo
    if (gameState.minions) {
        for (const minion of gameState.minions) {
            if (minion.team !== player.team && minion.health > 0) {
                const dist = Math.hypot(x - minion.x, y - minion.y);
                const minionRadius = (minion.size || 16) / 2;
                if (dist <= minionRadius + 5) {
                    focusTarget = { type: 'minion', id: minion.id };
                    sendTacticalCommand('focus');
                    return;
                }
            }
        }
    }
    
    // Verificar se clicou em uma torre inimiga
    if (gameState.towers) {
        for (const tower of gameState.towers) {
            if (tower.team !== player.team && tower.health > 0) {
                const dist = Math.hypot(x - tower.x, y - tower.y);
                if (dist <= 30) {
                    focusTarget = { type: 'tower', id: tower.id };
                    sendTacticalCommand('focus');
                    return;
                }
            }
        }
    }
    
    // Se não clicou em nada válido, cancelar seleção
    isSelectingTarget = false;
    const statusEl = document.getElementById('tactical-status');
    if (statusEl) {
        statusEl.textContent = 'Comando atual: Nenhum';
        statusEl.style.color = '#95a5a6';
    }
    canvas.style.cursor = 'default';
    
    // Reabrir modal se necessário
    if (gameState && gameState.status === 'in_game') {
        setTimeout(() => openGameMenu(), 300);
    }
}

// O listener handleTargetSelection será chamado através de handleCanvasClickForPlacement

// Tentar configurar listeners imediatamente ou aguardar
if (window.socket) {
    setupSocketListeners();
} else {
    // Aguardar socket estar disponível
    const checkSocket = setInterval(() => {
        if (window.socket) {
            setupSocketListeners();
            clearInterval(checkSocket);
        }
    }, 100);
}

