const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'seu-secret-super-seguro-aqui';

class GameServer {
  constructor() {
    this.lobbies = new Map(); // Map<lobbyId, Lobby>
    this.players = new Map(); // Map<socketId, Player>
    this.waitingPlayers = []; // Array de players esperando match
    
    // Limpar lobbies órfãos periodicamente (a cada 5 minutos)
    setInterval(() => {
      this.cleanupOrphanLobbies();
    }, 300000); // 5 minutos
  }
  
  cleanupOrphanLobbies() {
    const now = Date.now();
    let cleaned = 0;
    for (let [lobbyId, lobby] of this.lobbies.entries()) {
      // Limpar lobbies vazios com mais de 5 minutos
      if (lobby.players.length === 0 && now - lobby.createdAt > 300000) {
        this.lobbies.delete(lobbyId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`🧹 Limpeza: ${cleaned} lobby(s) órfão(s) removido(s)`);
    }
  }

  initialize(io) {
    this.io = io;

    io.on('connection', (socket) => {
      console.log('🔌 Cliente conectado:', socket.id);
      
      // Listener genérico para capturar TODOS os eventos (debug)
      try {
        if (socket.onAny) {
          socket.onAny((eventName, ...args) => {
            if (eventName === 'player_attack') {
              console.log(`\n🔥🔥🔥 [onAny] EVENTO player_attack RECEBIDO! 🔥🔥🔥`);
              console.log(`   Socket: ${socket.id}`);
              console.log(`   Data:`, args[0]);
            } else if (eventName !== 'player_move' && eventName !== 'authenticate') {
              console.log(`📥 [onAny] Evento: ${eventName} de ${socket.id}`);
            }
          });
        }
      } catch (e) {
        console.log('⚠️ onAny não disponível:', e.message);
      }

      // Autenticar jogador
      socket.on('authenticate', (data) => {
        try {
          const decoded = jwt.verify(data.token, JWT_SECRET);
          this.players.set(socket.id, {
            socketId: socket.id,
            userId: decoded.userId,
            username: decoded.username,
            lobbyId: null,
            gameId: null
          });
          socket.emit('authenticated', { username: decoded.username });
          console.log(`Jogador autenticado: ${decoded.username}`);
        } catch (error) {
          socket.emit('auth_error', { error: 'Token inválido' });
        }
      });

      // Criar lobby
      socket.on('create_lobby', () => {
        const player = this.players.get(socket.id);
        if (!player) {
          socket.emit('error', { message: 'Não autenticado' });
          return;
        }

        // Gerar ID de 4 dígitos (1000-9999)
        let lobbyId;
        let attempts = 0;
        do {
          lobbyId = String(Math.floor(1000 + Math.random() * 9000));
          attempts++;
          if (attempts > 100) {
            // Fallback se houver muitos lobbies ativos
            lobbyId = String(Date.now() % 10000).padStart(4, '0');
            break;
          }
        } while (this.lobbies.has(lobbyId));

        const lobby = {
          id: lobbyId,
          host: player.userId,
          players: [player],
          status: 'waiting', // waiting, preparing, in_game
          readyPlayers: new Set(), // Jogadores prontos no lobby
          createdAt: Date.now()
        };

        this.lobbies.set(lobbyId, lobby);
        player.lobbyId = lobbyId;
        socket.join(lobbyId);
        socket.emit('lobby_created', { lobbyId, lobby });
        
        // Notificar sobre o próprio jogador entrando
        socket.emit('lobby_player_joined', {
          player: { username: player.username, userId: player.userId }
        });
        
        console.log(`Lobby criado: ${lobbyId} por ${player.username}`);
      });

      // Entrar em lobby
      socket.on('join_lobby', (data) => {
        const player = this.players.get(socket.id);
        if (!player) {
          socket.emit('error', { message: 'Não autenticado' });
          return;
        }

        // Normalizar o lobbyId (aceitar string numérica ou número)
        let lobbyId = data.lobbyId;
        if (typeof lobbyId === 'number') {
          lobbyId = String(lobbyId);
        }
        // Remover espaços e garantir que seja apenas números
        lobbyId = String(lobbyId).trim().replace(/\D/g, '');
        
        // Validar que seja um número de 4 dígitos
        if (!lobbyId || lobbyId.length !== 4 || !/^\d{4}$/.test(lobbyId)) {
          socket.emit('error', { message: 'ID da sala inválido. Use um número de 4 dígitos.' });
          return;
        }

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) {
          socket.emit('error', { message: 'Sala não encontrada. Verifique o ID e tente novamente.' });
          return;
        }

        if (lobby.players.length >= 2) {
          socket.emit('error', { message: 'Sala cheia. Máximo de 2 jogadores.' });
          return;
        }

        // Verificar se o jogador já está em outro lobby
        if (player.lobbyId && player.lobbyId !== lobbyId) {
          // Remover do lobby anterior
          const oldLobby = this.lobbies.get(player.lobbyId);
          if (oldLobby) {
            oldLobby.players = oldLobby.players.filter(p => p.userId !== player.userId);
            socket.leave(player.lobbyId);
            if (oldLobby.players.length === 0) {
              this.lobbies.delete(player.lobbyId);
            }
          }
        }

        lobby.players.push(player);
        player.lobbyId = lobbyId;
        socket.join(lobbyId);
        
        // Notificar todos no lobby (incluindo o novo jogador)
        this.io.to(lobbyId).emit('player_joined', {
          lobby,
          player: { username: player.username, userId: player.userId }
        });
        
        // Notificar todos sobre o novo jogador entrando na sala
        this.io.to(lobbyId).emit('lobby_player_joined', {
          player: { username: player.username, userId: player.userId }
        });

        // Se tiver 2 jogadores, pode começar
        if (lobby.players.length === 2) {
          lobby.status = 'ready';
          // Garantir que readyPlayers existe
          if (!lobby.readyPlayers) lobby.readyPlayers = new Set();
          this.io.to(lobbyId).emit('lobby_ready', { lobby });
          
          // Enviar estado atual de prontidão
          this.io.to(lobbyId).emit('player_ready_update', {
            readyCount: lobby.readyPlayers.size,
            totalPlayers: lobby.players.length,
            readyPlayers: Array.from(lobby.readyPlayers)
          });
        }
        
        console.log(`Jogador ${player.username} entrou no lobby ${lobbyId}`);
      });

      // Movimento do jogador no lobby
      socket.on('lobby_player_move', (data) => {
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) return;

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby || lobby.status === 'in_game') return;

        // Broadcast movimento para outros jogadores no lobby
        socket.to(player.lobbyId).emit('lobby_player_moved', {
          playerId: player.userId,
          position: data.position,
          direction: data.direction
        });
      });

      // Iniciar jogo
      socket.on('start_game', () => {
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) {
          socket.emit('error', { message: 'Você não está em um lobby' });
          return;
        }

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby || lobby.players.length < 1) {
          socket.emit('error', { message: 'Lobby não está pronto' });
          return;
        }

        if (lobby.host !== player.userId) {
          socket.emit('error', { message: 'Apenas o host pode iniciar o jogo' });
          return;
        }

        // Mudar para estado de preparação
        lobby.status = 'preparing';
        lobby.readyPlayers = new Set();
        const gameId = `game_${Date.now()}`;
        lobby.gameId = gameId;

        // Inicializar estado do jogo
        const gameState = this.initializeGameState(lobby);

        console.log(`\n🎮 FASE DE PREPARAÇÃO INICIADA: ${gameId} no lobby ${player.lobbyId}`);
        console.log(`   Players: ${gameState.players.length}`);
        console.log(`   Torres: ${gameState.towers.length}\n`);

        // Notificar jogadores que entraram na fase de preparação
        this.io.to(player.lobbyId).emit('game_preparation_started', {
          gameId,
          gameState
        });
      });

      // Movimento do jogador
      socket.on('player_move', (data) => {
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) return;

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby || lobby.status !== 'in_game' || !lobby.gameState) return;

        // Atualizar posição no estado do jogo (canvas é 1000x700)
        const gamePlayer = lobby.gameState.players.find(p => p.id === player.userId);
        if (gamePlayer) {
          const newX = Math.max(0, Math.min(1000, data.position.x));
          const newY = Math.max(0, Math.min(700, data.position.y));
          
          // Verificar se pode atravessar o rio (usando posição atual e nova posição)
          if (this.canCrossRiver(gamePlayer.position.x, gamePlayer.position.y, newX, newY)) {
            // Verificar colisão com torres
            if (!this.checkTowerCollision(newX, newY, lobby.gameState)) {
              gamePlayer.position.x = newX;
              gamePlayer.position.y = newY;
            }
            // Se houver colisão com torre, manter posição anterior
          } else {
            // Se não pode atravessar, manter posição anterior
            // Não atualizar posição
          }
        }

        // Broadcast movimento para outros jogadores no lobby
        socket.to(player.lobbyId).emit('player_moved', {
          playerId: player.userId,
          position: data.position,
          direction: data.direction
        });
      });

      // Ataque do jogador
      socket.on('player_attack', (data) => {
        console.log(`\n🗡️ RECEBIDO: player_attack de socket ${socket.id}`);
        console.log(`   Posição: (${data.position.x}, ${data.position.y})`);
        
        const player = this.players.get(socket.id);
        if (!player) {
          console.log(`❌ ERRO: Jogador não encontrado no socket ${socket.id}`);
          return;
        }
        if (!player.lobbyId) {
          console.log(`❌ ERRO: Jogador ${player.username} não está em um lobby`);
          return;
        }

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby) {
          console.log(`❌ ERRO: Lobby ${player.lobbyId} não encontrado`);
          return;
        }
        if (lobby.status !== 'in_game') {
          console.log(`❌ ERRO: Lobby não está em jogo, status: ${lobby.status}`);
          return;
        }
        if (!lobby.gameState) {
          console.log(`❌ ERRO: gameState não existe no lobby`);
          return;
        }

        const state = lobby.gameState;
        const gamePlayer = state.players.find(p => p.id === player.userId);
        
        if (!gamePlayer) {
          console.log(`❌ ERRO: gamePlayer não encontrado para userId ${player.userId}`);
          console.log(`   Players disponíveis:`, state.players.map(p => p.id));
          return;
        }

        const now = Date.now();
        
        // Verificar cooldown
        if (now - gamePlayer.lastAttack < gamePlayer.attackCooldown) {
          console.log(`⏳ Ataque em cooldown: ${now - gamePlayer.lastAttack}ms / ${gamePlayer.attackCooldown}ms`);
          return; // Ainda em cooldown
        }

        gamePlayer.lastAttack = now;

        // Criar animação de ataque
        const isSpecialAttack = data.isSpecialAttack || false;
        const attack = {
          id: `attack_${Date.now()}_${player.userId}`,
          playerId: player.userId,
          x: data.position.x,
          y: data.position.y,
          team: gamePlayer.team,
          timestamp: now,
          radius: isSpecialAttack ? 100 : 50, // Super golpe tem raio maior
          isSpecial: isSpecialAttack
        };
        
        console.log(`✅ Ataque criado: ${attack.id} de ${gamePlayer.username} (${gamePlayer.team}) em (${attack.x}, ${attack.y})`);
        console.log(`   Raio de ataque: ${attack.radius}px`);

        state.attacks.push(attack);

        // Verificar colisão com jogadores inimigos
        let hits = 0;
        state.players.forEach(target => {
          if (target.team === gamePlayer.team || target.id === gamePlayer.id) return;
          
          const distance = Math.hypot(
            attack.x - target.position.x,
            attack.y - target.position.y
          );

          console.log(`   Distância até ${target.username}: ${distance.toFixed(2)}px (limite: ${attack.radius + 18}px)`);

          if (distance <= attack.radius + 18) { // 18 é o raio do jogador
            const oldHealth = target.health;
            const damage = data.isSpecialAttack ? 10 : 1; // Super golpe causa 10 de dano
            target.health = Math.max(0, target.health - damage);
            hits++;
            
            // Criar floating damage text
            if (!state.damageTexts) state.damageTexts = [];
            state.damageTexts.push({
              id: `damage_${Date.now()}_${target.id}`,
              x: target.position.x,
              y: target.position.y,
              value: damage,
              timestamp: now,
              isSpecial: data.isSpecialAttack || false
            });
            
            console.log(`   ✅ HIT! Jogador ${target.username} atingido! HP: ${oldHealth} → ${target.health} (dano: ${damage})`);
            
            // Verificar se o jogador morreu
            if (target.health <= 0) {
              console.log(`💀 Jogador ${target.username} morreu!`);
              const winner = this.checkWinner(state);
              if (winner) {
                state.winner = winner;
                this.io.to(player.lobbyId).emit('game_over', { winner });
              }
            }
          }
        });

        // Verificar colisão com minions inimigos
        state.minions.forEach(minion => {
          if (minion.team === gamePlayer.team) return;
          
          const distance = Math.hypot(
            attack.x - minion.x,
            attack.y - minion.y
          );

          const minionRadius = (minion.size || 16) / 2;
          if (distance <= attack.radius + minionRadius) {
            const oldHealth = minion.health;
            const oldShield = minion.defenseShield || 0;
            const damage = data.isSpecialAttack ? 15 : 3; // Super golpe causa 15 de dano
            const damageResult = this.applyDamageToMinion(minion, damage);
            hits++;
            
            // Rastrear quem causou o dano (para dar moeda quando morrer)
            minion.lastDamagedBy = {
              type: 'player',
              playerId: gamePlayer.id,
              team: gamePlayer.team
            };
            
            // Se o minion morreu, dar moeda diretamente ao jogador
            if (minion.health <= 0 && oldHealth > 0) {
              gamePlayer.coins = (gamePlayer.coins || 0) + 1;
              console.log(`💰 Jogador ${gamePlayer.username} ganhou 1 moeda por matar minion ${minion.id}! Total: ${gamePlayer.coins}`);
            }
            
            // Criar floating damage text
            if (!state.damageTexts) state.damageTexts = [];
            state.damageTexts.push({
              id: `damage_${Date.now()}_${minion.id}`,
              x: minion.x,
              y: minion.y,
              value: damage,
              timestamp: now,
              isSpecial: data.isSpecialAttack || false
            });
            
            console.log(`   ✅ HIT! Minion ${minion.id} atingido! HP: ${oldHealth} → ${minion.health} (dano: ${damage})`);
          }
        });

        // Verificar colisão com torres inimigas
        console.log(`   Verificando ${state.towers.length} torres...`);
        state.towers.forEach(tower => {
          if (tower.team === gamePlayer.team) {
            console.log(`   ⏭️  Torre ${tower.id} é do mesmo time (${tower.team}), pulando`);
            return;
          }
          if (tower.health <= 0) {
            console.log(`   ⏭️  Torre ${tower.id} já está destruída, pulando`);
            return;
          }
          
          const distance = Math.hypot(
            attack.x - tower.x,
            attack.y - tower.y
          );

          const hitRadius = attack.radius + 30;
          console.log(`   Torre ${tower.id} (${tower.team}): distância=${distance.toFixed(2)}px, limite=${hitRadius}px, HP=${tower.health}`);

          // Raio da torre é ~20 (metade do tamanho 40x40)
          // Aumentar raio de detecção para facilitar acertar
          if (distance <= hitRadius) {
            const oldHealth = tower.health;
            const damage = data.isSpecialAttack ? 20 : 5; // Super golpe causa 20 de dano
            tower.health = Math.max(0, tower.health - damage);
            hits++;
            
            // Criar floating damage text
            if (!state.damageTexts) state.damageTexts = [];
            state.damageTexts.push({
              id: `damage_${Date.now()}_${tower.id}`,
              x: tower.x,
              y: tower.y,
              value: damage,
              timestamp: now,
              isSpecial: data.isSpecialAttack || false
            });
            
            console.log(`   ✅✅✅ HIT NA TORRE! ${tower.id} (${tower.team}) HP: ${oldHealth} → ${tower.health}/${tower.maxHealth} (dano: ${damage})`);
          } else {
            console.log(`   ❌ Fora do alcance (${distance.toFixed(2)} > ${hitRadius})`);
          }
        });

        console.log(`📊 Total de hits: ${hits}`);

        // Broadcast ataque para todos (incluindo o atacante)
        const cleanState = this.sanitizeGameState(state);
        this.io.to(player.lobbyId).emit('player_attacked', {
          playerId: player.userId,
          attack: attack,
          gameState: cleanState
        });
        
        // Também enviar atualização de estado imediatamente
        this.io.to(player.lobbyId).emit('game_state_update', { gameState: cleanState });
        console.log(`📤 Estado atualizado enviado para ${player.lobbyId}\n`);
      });

      // Super golpe (poder especial)
      socket.on('special_attack', (data) => {
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) return;

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby || lobby.status !== 'in_game' || !lobby.gameState) return;

        const state = lobby.gameState;
        const gamePlayer = state.players.find(p => p.id === player.userId);
        if (!gamePlayer) return;

        // Verificar se tem moedas suficientes (3 moedas)
        if (gamePlayer.coins < 3) {
          console.log(`❌ Jogador ${gamePlayer.username} não tem moedas suficientes para super golpe (${gamePlayer.coins}/3)`);
          return;
        }

        // Verificar cooldown
        const now = Date.now();
        if (now - gamePlayer.lastAttack < gamePlayer.attackCooldown) {
          return;
        }

        // Gastar moedas
        gamePlayer.coins -= 3;
        gamePlayer.lastAttack = now;

        // Criar super ataque
        const attack = {
          id: `special_attack_${Date.now()}_${player.userId}`,
          playerId: player.userId,
          x: data.position.x || gamePlayer.position.x,
          y: data.position.y || gamePlayer.position.y,
          team: gamePlayer.team,
          timestamp: now,
          radius: 100, // Raio maior para super golpe
          isSpecial: true
        };

        state.attacks.push(attack);

        // Verificar colisão com TODOS os minions inimigos ao redor
        let hits = 0;
        state.minions.forEach(minion => {
          if (minion.team === gamePlayer.team) return;
          
          const distance = Math.hypot(
            attack.x - minion.x,
            attack.y - minion.y
          );

          const minionRadius = (minion.size || 16) / 2;
          if (distance <= attack.radius + minionRadius) {
            const oldHealth = minion.health;
            const oldShield = minion.defenseShield || 0;
            const damageResult = this.applyDamageToMinion(minion, 15); // Dano alto
            hits++;
            
            // Rastrear quem causou o dano (para dar moeda quando morrer)
            minion.lastDamagedBy = {
              type: 'player',
              playerId: gamePlayer.id,
              team: gamePlayer.team
            };
            
            // Se o minion morreu, dar moeda diretamente ao jogador
            if (minion.health <= 0 && oldHealth > 0) {
              gamePlayer.coins = (gamePlayer.coins || 0) + 1;
              console.log(`💰 Jogador ${gamePlayer.username} ganhou 1 moeda por matar minion ${minion.id} com super golpe! Total: ${gamePlayer.coins}`);
            }
            
            // Criar floating damage text
            if (!state.damageTexts) state.damageTexts = [];
            state.damageTexts.push({
              id: `damage_${Date.now()}_${minion.id}`,
              x: minion.x,
              y: minion.y,
              value: 15,
              timestamp: now,
              isSpecial: true
            });
            
            console.log(`   💥 SUPER GOLPE! Minion ${minion.id} atingido! HP: ${oldHealth} → ${minion.health}`);
          }
        });

        // Verificar colisão com jogadores inimigos
        state.players.forEach(target => {
          if (target.team === gamePlayer.team || target.id === gamePlayer.id) return;
          
          const distance = Math.hypot(
            attack.x - target.position.x,
            attack.y - target.position.y
          );

          if (distance <= attack.radius + 18) {
            const oldHealth = target.health;
            target.health = Math.max(0, target.health - 10);
            hits++;
            
            if (!state.damageTexts) state.damageTexts = [];
            state.damageTexts.push({
              id: `damage_${Date.now()}_${target.id}`,
              x: target.position.x,
              y: target.position.y,
              value: 10,
              timestamp: now,
              isSpecial: true
            });
            
            console.log(`   💥 SUPER GOLPE! Jogador ${target.username} atingido! HP: ${oldHealth} → ${target.health}`);
            
            // Verificar se o jogador morreu
            if (target.health <= 0) {
              console.log(`💀 Jogador ${target.username} morreu por super golpe!`);
              const winner = this.checkWinner(state);
              if (winner) {
                state.winner = winner;
                this.io.to(player.lobbyId).emit('game_over', { winner });
              }
            }
          }
        });

        // Verificar colisão com torres inimigas
        state.towers.forEach(tower => {
          if (tower.team === gamePlayer.team || tower.health <= 0) return;
          
          const distance = Math.hypot(attack.x - tower.x, attack.y - tower.y);
          if (distance <= attack.radius + 30) {
            const oldHealth = tower.health;
            tower.health = Math.max(0, tower.health - 20);
            hits++;
            
            if (!state.damageTexts) state.damageTexts = [];
            state.damageTexts.push({
              id: `damage_${Date.now()}_${tower.id}`,
              x: tower.x,
              y: tower.y,
              value: 20,
              timestamp: now,
              isSpecial: true
            });
            
            console.log(`   💥 SUPER GOLPE! Torre ${tower.id} atingida! HP: ${oldHealth} → ${tower.health}`);
          }
        });

        console.log(`💥 Super golpe executado! ${hits} alvos atingidos, ${gamePlayer.coins} moedas restantes`);

        // Broadcast
        const cleanState = this.sanitizeGameState(state);
        this.io.to(player.lobbyId).emit('player_attacked', {
          playerId: player.userId,
          attack: attack,
          gameState: cleanState
        });
        this.io.to(player.lobbyId).emit('game_state_update', { gameState: cleanState });
      });

      // HACK: Adicionar moeda
      socket.on('hack_add_coin', () => {
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) return;

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby || lobby.status !== 'in_game' || !lobby.gameState) return;

        const state = lobby.gameState;
        const gamePlayer = state.players.find(p => p.id === player.userId);
        if (!gamePlayer) return;

        // Adicionar 1 moeda
        gamePlayer.coins = (gamePlayer.coins || 0) + 1;
        console.log(`💰 HACK: Jogador ${gamePlayer.username} recebeu 1 moeda! Total: ${gamePlayer.coins}`);

        // Broadcast estado atualizado
        const cleanState = this.sanitizeGameState(state);
        this.io.to(player.lobbyId).emit('game_state_update', { gameState: cleanState });
      });

      // Upgrade na torre
      socket.on('upgrade_tower', () => {
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) return;

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby || lobby.status !== 'in_game' || !lobby.gameState) return;

        const state = lobby.gameState;
        const gamePlayer = state.players.find(p => p.id === player.userId);
        if (!gamePlayer) return;

        // Verificar se está perto de uma torre do próprio time
        const playerTowers = state.towers.filter(t => t.team === gamePlayer.team);
        let nearTower = null;
        let minDist = Infinity;

        playerTowers.forEach(tower => {
          const dist = Math.hypot(
            gamePlayer.position.x - tower.x,
            gamePlayer.position.y - tower.y
          );
          if (dist < 50 && dist < minDist) {
            minDist = dist;
            nearTower = tower;
          }
        });

        if (!nearTower) {
          console.log(`❌ Jogador ${gamePlayer.username} não está perto de uma torre`);
          return;
        }

        // Custo crescente: nível 0->1 = 5, nível 1->2 = 10, nível 2->3 = 20 (dobra a cada nível)
        let upgradeCost;
        if (nearTower.upgradeLevel === 0) {
          upgradeCost = 5; // Nível 0 → 1: 5 moedas
        } else if (nearTower.upgradeLevel === 1) {
          upgradeCost = 10; // Nível 1 → 2: 10 moedas
        } else {
          // Nível 2+ → dobra a cada nível: 20, 40, 80, 160...
          upgradeCost = 5 * Math.pow(2, nearTower.upgradeLevel);
        }
        
        // Verificar se tem moedas suficientes
        if (gamePlayer.coins < upgradeCost) {
          console.log(`❌ Jogador ${gamePlayer.username} não tem moedas suficientes (${gamePlayer.coins}/${upgradeCost})`);
          return;
        }

        // Fazer upgrade
        gamePlayer.coins -= upgradeCost;
        nearTower.upgradeLevel += 1;
        console.log(`✅ Upgrade realizado! Torre ${nearTower.id} agora está no nível ${nearTower.upgradeLevel}, custo: ${upgradeCost}, jogador tem ${gamePlayer.coins} moedas`);

        // Broadcast atualização
        const cleanState = this.sanitizeGameState(state);
        this.io.to(player.lobbyId).emit('game_state_update', { gameState: cleanState });
      });

      // Comprar tropas na loja (fase de preparação)
      socket.on('buy_troops', (data) => {
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) return;

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby || lobby.status !== 'preparing' || !lobby.gameState) return;

        const state = lobby.gameState;
        const gamePlayer = state.players.find(p => p.id === player.userId);
        if (!gamePlayer) return;

        const troopType = data.type; // 'melee' ou 'ranged'
        const quantity = data.quantity || 5; // Quantidade de tropas (padrão: 5)
        const costPerTroop = 10; // Custo por tropa
        const totalCost = costPerTroop * quantity;

        // Verificar se tem moedas suficientes
        if (gamePlayer.coins < totalCost) {
          console.log(`❌ Jogador ${gamePlayer.username} não tem moedas suficientes (${gamePlayer.coins}/${totalCost})`);
          return;
        }

        // Calcular upgradeLevel da torre do time
        const playerTowers = state.towers.filter(t => t.team === gamePlayer.team);
        const upgradeLevel = playerTowers.length > 0 ? Math.max(...playerTowers.map(t => t.upgradeLevel || 0)) : 0;
        const minionDamage = 1 + (upgradeLevel * 2);
        const minionHealth = 20 + (upgradeLevel * 10);
        const minionMaxHealth = minionHealth;
        const minionSize = 24; // Tamanho maior para melhor visualização

        // Criar tropas no inventário do jogador (não spawnar ainda)
        const now = Date.now();
        if (!gamePlayer.troops) gamePlayer.troops = [];
        
        for (let i = 0; i < quantity; i++) {
          const troop = {
            id: `troop_${now}_${gamePlayer.team}_${i}_${Math.random().toString(36).substr(2, 5)}`,
            type: troopType,
            team: gamePlayer.team,
            health: minionHealth,
            maxHealth: minionMaxHealth,
            speed: troopType === 'ranged' ? 2.0 : 2.5,
            damage: minionDamage,
            attackCooldown: troopType === 'ranged' ? 2500 : 1500, // Aumentado para diminuir velocidade de ataque
            attackRange: troopType === 'ranged' ? 120 : 25,
            size: minionSize,
            upgradeLevel: upgradeLevel,
            x: null, // Será definido quando posicionado
            y: null,
            placed: false // Indica se foi posicionado no campo
          };
          
          gamePlayer.troops.push(troop);
          console.log(`✅ ${troopType === 'ranged' ? 'Arqueiro' : 'Guerreiro'} comprado por ${gamePlayer.username}! Adicionado ao inventário`);
        }

        // Deduzir moedas
        gamePlayer.coins -= totalCost;
        console.log(`💰 Jogador ${gamePlayer.username} comprou ${quantity} ${troopType === 'ranged' ? 'arqueiros' : 'guerreiros'} por ${totalCost} moedas. Moedas restantes: ${gamePlayer.coins}`);

        // Broadcast atualização
        const cleanState = this.sanitizeGameState(state);
        this.io.to(player.lobbyId).emit('game_state_update', { gameState: cleanState });
      });

      // Posicionar tropa no campo
      socket.on('place_troop', (data) => {
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) return;

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby || lobby.status !== 'preparing' || !lobby.gameState) return;

        const state = lobby.gameState;
        const gamePlayer = state.players.find(p => p.id === player.userId);
        if (!gamePlayer || !gamePlayer.troops) return;

        const { troopId, x, y } = data;
        const troop = gamePlayer.troops.find(t => t.id === troopId && !t.placed);
        if (!troop) {
          console.log(`❌ Tropa ${troopId} não encontrada ou já posicionada`);
          return;
        }

        // Validar posição (deve estar no campo do jogador)
        // Canvas atual: 1000x700
        const mapWidth = state.mapWidth || 1000;
        const mapHeight = state.mapHeight || 700;
        const validX = gamePlayer.team === 'left' 
          ? (x >= 0 && x <= mapWidth / 2) 
          : (x >= mapWidth / 2 && x <= mapWidth);
        const validY = y >= 0 && y <= mapHeight;
        
        if (!validX || !validY) {
          console.log(`❌ Posição inválida para ${gamePlayer.username}: (${x}, ${y}) - Campo: ${gamePlayer.team === 'left' ? '0-' + mapWidth/2 : mapWidth/2 + '-' + mapWidth} x 0-${mapHeight}`);
          socket.emit('error', { message: 'Posição inválida. Tente novamente.' });
          return;
        }
        
        // Validação adicional: verificar se não está muito próximo de outra tropa (mínimo 20px)
        const nearbyTroop = gamePlayer.troops.find(t => 
          t.placed && 
          t.id !== troopId &&
          Math.hypot(t.x - x, t.y - y) < 20
        );
        if (nearbyTroop) {
          console.log(`❌ Posição muito próxima de outra tropa para ${gamePlayer.username}: (${x}, ${y})`);
          socket.emit('error', { message: 'Posição muito próxima de outra tropa. Mantenha pelo menos 20px de distância.' });
          return;
        }

        // Posicionar tropa
        troop.x = x;
        troop.y = y;
        troop.placed = true;

        // Adicionar ao estado de minions
        const minion = {
          id: troop.id,
          x: troop.x,
          y: troop.y,
          team: troop.team,
          type: troop.type,
          health: troop.health,
          maxHealth: troop.maxHealth,
          speed: troop.speed,
          size: 24, // Tamanho maior para melhor visualização
          targetTower: null,
          targetMinion: null,
          targetPlayer: null,
          damage: troop.damage,
          lastAttack: 0,
          attackCooldown: troop.attackCooldown,
          lastAttackAnimation: 0,
          attackRange: troop.attackRange,
          size: troop.size,
          upgradeLevel: troop.upgradeLevel,
          placedTime: Date.now(), // Timestamp para destacar visualmente
          // Novas propriedades para mecânicas
          lastPosition: { x: troop.x, y: troop.y }, // Para detectar movimento
          stationaryTime: 0, // Tempo parado (para habilidade especial do arqueiro)
          specialAttackReady: false // Se arqueiro está pronto para tiro especial
        };
        
        state.minions.push(minion);
        console.log(`📍 Tropa ${troopId} posicionada por ${gamePlayer.username} em (${x.toFixed(0)}, ${y.toFixed(0)})`);
        console.log(`   Minion criado: ${JSON.stringify({id: minion.id, x: minion.x, y: minion.y, team: minion.team, type: minion.type})}`);
        console.log(`   Total de minions no estado: ${state.minions.length}`);

        // Broadcast atualização
        const cleanState = this.sanitizeGameState(state);
        this.io.to(player.lobbyId).emit('game_state_update', { gameState: cleanState });
        console.log(`   ✅ Estado atualizado enviado para clientes`);
      });

      // Flecha especial (poder especial - 50 moedas)
      socket.on('arrow_special_attack', (data) => {
        console.log('🏹🏹🏹 RECEBIDO arrow_special_attack no servidor!', { socketId: socket.id, data });
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) {
          console.log('❌ Player ou lobbyId não encontrado');
          socket.emit('arrow_error', { message: 'Player não encontrado' });
          return;
        }

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby) {
          console.log('❌ Lobby não encontrado');
          socket.emit('arrow_error', { message: 'Lobby não encontrado' });
          return;
        }
        
        if (lobby.status !== 'in_game') {
          console.log(`❌ Jogo não está em andamento. Status: ${lobby.status}`);
          socket.emit('arrow_error', { message: `Jogo não está em andamento. Status: ${lobby.status}` });
          return;
        }
        
        if (!lobby.gameState) {
          console.log('❌ gameState não existe');
          socket.emit('arrow_error', { message: 'Estado do jogo não encontrado' });
          return;
        }

        const state = lobby.gameState;
        const gamePlayer = state.players.find(p => p.id === player.userId);
        if (!gamePlayer) {
          console.log(`❌ gamePlayer não encontrado. userId: ${player.userId}, players: ${state.players.map(p => p.id).join(', ')}`);
          socket.emit('arrow_error', { message: 'Jogador não encontrado no jogo' });
          return;
        }

        // Verificar se tem moedas suficientes (50 moedas)
        if (gamePlayer.coins < 50) {
          console.log(`❌ Jogador ${gamePlayer.username} não tem moedas suficientes para flecha especial (${gamePlayer.coins}/50)`);
          socket.emit('arrow_error', { message: `Moedas insuficientes (${gamePlayer.coins}/50)` });
          return;
        }

        // Gastar moedas
        gamePlayer.coins -= 50;
        console.log(`🏹 Jogador ${gamePlayer.username} gastou 50 moedas para flecha especial. Restantes: ${gamePlayer.coins}`);

        // Calcular direção da flecha
        const direction = data.direction || { x: 1, y: 0 };
        const directionLength = Math.hypot(direction.x, direction.y);
        const normalizedDirection = directionLength > 0 
          ? { x: direction.x / directionLength, y: direction.y / directionLength }
          : { x: 1, y: 0 };

        // Posição inicial da flecha
        const startX = data.position?.x || gamePlayer.position.x;
        const startY = data.position?.y || gamePlayer.position.y;

        // Criar projétil especial de flecha
        const arrow = {
          id: `arrow_${Date.now()}_${player.userId}`,
          x: startX,
          y: startY,
          startX: startX,
          startY: startY,
          directionX: normalizedDirection.x,
          directionY: normalizedDirection.y,
          team: gamePlayer.team,
          speed: 15, // Velocidade da flecha
          damage: 300, // Dano em área
          radius: 80, // Raio de dano em área
          timestamp: Date.now(),
          type: 'arrow_special',
          maxDistance: 2000 // Distância máxima que a flecha pode percorrer
        };

        if (!state.projectiles) state.projectiles = [];
        state.projectiles.push(arrow);

        console.log(`🏹 Flecha especial criada! Posição: (${startX.toFixed(1)}, ${startY.toFixed(1)}), Direção: (${normalizedDirection.x.toFixed(2)}, ${normalizedDirection.y.toFixed(2)}), Total projéteis: ${state.projectiles.length}`);

        // Broadcast atualização
        const cleanState = this.sanitizeGameState(state);
        this.io.to(player.lobbyId).emit('game_state_update', { gameState: cleanState });
        console.log(`✅ Estado atualizado enviado com flecha especial`);
      });

      // Comando tático do jogador
      socket.on('tactical_command', (data) => {
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) return;

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby || lobby.status !== 'in_game' || !lobby.gameState) return;

        const state = lobby.gameState;
        const gamePlayer = state.players.find(p => p.id === player.userId);
        if (!gamePlayer) return;

        // Verificar cooldown de comandos táticos (5 segundos)
        const now = Date.now();
        if (gamePlayer.lastTacticalCommandTime && (now - gamePlayer.lastTacticalCommandTime) < 5000) {
          const remainingCooldown = Math.ceil((5000 - (now - gamePlayer.lastTacticalCommandTime)) / 1000);
          console.log(`⏳ Comando tático em cooldown! Aguarde ${remainingCooldown} segundo(s)`);
          socket.emit('tactical_command_error', { message: `Aguarde ${remainingCooldown} segundo(s) antes de usar outro comando tático` });
          return;
        }

        // Se mudou de comando, remover escudo de defesa dos minions anteriores
        if (gamePlayer.tacticalCommand === 'defend' && data.command !== 'defend') {
          state.minions.forEach(m => {
            if (m.team === gamePlayer.team && m.type === 'melee') {
              m.defenseShield = 0;
              m.maxDefenseShield = 0;
            }
          });
        }
        
        // Armazenar comando tático do jogador
        gamePlayer.tacticalCommand = data.command;
        gamePlayer.tacticalCommandTime = Date.now();
        gamePlayer.lastTacticalCommandTime = Date.now(); // Para cooldown
        gamePlayer.tacticalTarget = data.targetId || null; // Alvo selecionado para focar
        
        console.log(`🎯 Jogador ${gamePlayer.username} enviou comando tático: ${data.command}${data.targetId ? ` (alvo: ${data.targetId.type}/${data.targetId.id})` : ''}`);
      });

      // Spawnar inimigos das torres inimigas (tecla I)
      socket.on('spawn_enemy_minions', () => {
        console.log('👾 Recebido pedido para spawnar inimigos');
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) {
          console.log('❌ Player ou lobbyId não encontrado');
          return;
        }

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby) {
          console.log('❌ Lobby não encontrado');
          socket.emit('spawn_error', { message: 'Lobby não encontrado' });
          return;
        }
        
        // Permitir spawnar durante 'in_game' ou 'preparing'
        if (lobby.status !== 'in_game' && lobby.status !== 'preparing') {
          console.log(`❌ Jogo não está em andamento. Status: ${lobby.status}`);
          socket.emit('spawn_error', { message: `Jogo não está em andamento. Status: ${lobby.status}` });
          return;
        }
        
        if (!lobby.gameState) {
          console.log('❌ gameState não existe');
          socket.emit('spawn_error', { message: 'Estado do jogo não encontrado' });
          return;
        }

        const state = lobby.gameState;
        const gamePlayer = state.players.find(p => p.id === player.userId);
        if (!gamePlayer) {
          console.log(`❌ gamePlayer não encontrado. userId: ${player.userId}, players: ${state.players.map(p => p.id).join(', ')}`);
          return;
        }

        // Determinar time inimigo
        const enemyTeam = gamePlayer.team === 'left' ? 'right' : 'left';
        
        // Encontrar torres inimigas
        const enemyTowers = state.towers.filter(t => t.team === enemyTeam && t.health > 0);
        
        if (enemyTowers.length === 0) {
          console.log(`❌ Nenhuma torre inimiga encontrada para spawnar minions`);
          return;
        }

        // Calcular dano baseado no upgradeLevel das torres inimigas
        const enemyUpgradeLevel = enemyTowers.length > 0 ? Math.max(...enemyTowers.map(t => t.upgradeLevel || 0)) : 0;
        const enemyMinionDamage = 1 + (enemyUpgradeLevel * 2);
        const enemyMinionHealth = 20 + (enemyUpgradeLevel * 10);
        const enemyMinionMaxHealth = enemyMinionHealth;
        const minionSize = 24;
        const now = Date.now();

        console.log(`👾 Spawnando minions inimigos (time: ${enemyTeam}) para ${gamePlayer.username}`);

        // Spawnar minions para cada torre inimiga
        enemyTowers.forEach((tower, towerIndex) => {
          // Spawnar 5 minions melee por torre
          for (let i = 0; i < 5; i++) {
            const yOffset = (i - 2) * 8;
            const spawnX = enemyTeam === 'left' ? 120 : 880;
            
            const enemyMinion = {
              id: `minion_${now}_${enemyTeam}_${towerIndex}_${i}_${Math.random().toString(36).substr(2, 5)}`,
              x: spawnX,
              y: tower.y + yOffset,
              team: enemyTeam,
              type: 'melee',
              health: enemyMinionHealth,
              maxHealth: enemyMinionMaxHealth,
              speed: 2.5,
              targetTower: null,
              targetMinion: null,
              damage: enemyMinionDamage,
              lastAttack: 0,
              attackCooldown: 1500,
              lastAttackAnimation: 0,
              size: minionSize,
              upgradeLevel: enemyUpgradeLevel
            };
            state.minions.push(enemyMinion);
            console.log(`✅ Minion INIMIGO (melee) criado: ${enemyMinion.id} em (${enemyMinion.x}, ${enemyMinion.y}) próximo à torre ${tower.id}`);
          }
          
          // Spawnar 1 minion ranged por torre
          const spawnX = enemyTeam === 'left' ? 120 : 880;
          const rangedMinion = {
            id: `minion_ranged_${now}_${enemyTeam}_${towerIndex}_${Math.random().toString(36).substr(2, 5)}`,
            x: spawnX,
            y: tower.y,
            team: enemyTeam,
            type: 'ranged',
            health: enemyMinionHealth,
            maxHealth: enemyMinionMaxHealth,
            speed: 2.0,
            targetTower: null,
            targetMinion: null,
            targetPlayer: null,
            damage: enemyMinionDamage,
            lastAttack: 0,
            attackCooldown: 2500,
            lastAttackAnimation: 0,
            attackRange: 120,
            size: minionSize,
            upgradeLevel: enemyUpgradeLevel
          };
          state.minions.push(rangedMinion);
          console.log(`✅ Minion INIMIGO (ranged) criado: ${rangedMinion.id} em (${rangedMinion.x}, ${rangedMinion.y}) próximo à torre ${tower.id}`);
        });

        // Broadcast atualização
        const cleanState = this.sanitizeGameState(state);
        this.io.to(player.lobbyId).emit('game_state_update', { gameState: cleanState });
        console.log(`✅ ${enemyTowers.length * 6} minions inimigos spawnados! Total de minions: ${state.minions.length}`);
      });

      // Jogador está pronto para começar (pode ser no lobby ou na fase de preparação)
      socket.on('player_ready', () => {
        const player = this.players.get(socket.id);
        if (!player || !player.lobbyId) return;

        const lobby = this.lobbies.get(player.lobbyId);
        if (!lobby) return;

        // Se estiver no lobby (waiting ou ready), marcar como pronto para iniciar
        if (lobby.status === 'waiting' || lobby.status === 'ready') {
          if (!lobby.readyPlayers) lobby.readyPlayers = new Set();
          lobby.readyPlayers.add(player.userId);

          console.log(`✅ Jogador ${player.username} está pronto no lobby! (${lobby.readyPlayers.size}/${lobby.players.length})`);

          // Notificar todos sobre a atualização de prontidão
          this.io.to(player.lobbyId).emit('player_ready_update', {
            readyCount: lobby.readyPlayers.size,
            totalPlayers: lobby.players.length,
            readyPlayers: Array.from(lobby.readyPlayers)
          });

          // Verificar se todos estão prontos (permite 1 jogador para testes)
          if (lobby.readyPlayers.size === lobby.players.length && lobby.players.length >= 1) {
            // Todos prontos, iniciar fase de preparação
            lobby.status = 'preparing';
            lobby.readyPlayers = new Set(); // Reset para fase de preparação
            const gameId = `game_${Date.now()}`;
            lobby.gameId = gameId;

            // Inicializar estado do jogo
            const gameState = this.initializeGameState(lobby);

            console.log(`\n🎮 FASE DE PREPARAÇÃO INICIADA: ${gameId} no lobby ${player.lobbyId}`);
            console.log(`   Players: ${gameState.players.length}`);
            console.log(`   Torres: ${gameState.towers.length}\n`);

            // Notificar jogadores que entraram na fase de preparação
            this.io.to(player.lobbyId).emit('game_preparation_started', {
              gameId,
              gameState
            });
          } else {
            // Ainda aguardando outros jogadores
            this.io.to(player.lobbyId).emit('player_ready_update', {
              readyCount: lobby.readyPlayers.size,
              totalPlayers: lobby.players.length
            });
          }
        } 
        // Se estiver na fase de preparação, marcar como pronto para iniciar a guerra
        else if (lobby.status === 'preparing') {
          if (!lobby.readyPlayers) lobby.readyPlayers = new Set();
          lobby.readyPlayers.add(player.userId);

          const gamePlayer = lobby.gameState?.players?.find(p => p.id === player.userId);
          if (gamePlayer) {
            gamePlayer.ready = true;
          }

          console.log(`✅ Jogador ${player.username} está pronto na preparação! (${lobby.readyPlayers.size}/${lobby.players.length})`);

          // Verificar se todos estão prontos (não precisa posicionar todas as tropas)
          if (lobby.readyPlayers.size === lobby.players.length) {
            // Todos prontos, iniciar guerra
            lobby.status = 'in_game';
            if (lobby.gameState) {
              lobby.gameState.status = 'in_game';
            }
            console.log(`\n🎮 ROUND ${lobby.currentRound} INICIADO! Todos os jogadores estão prontos.`);
            
            // Iniciar game loop
            this.startGameLoop(lobby);
            
            // Log dos minions antes de enviar
            console.log(`📊 Enviando game_started com ${lobby.gameState.minions?.length || 0} minions`);
            if (lobby.gameState.minions && lobby.gameState.minions.length > 0) {
              console.log(`   Primeiros minions:`, lobby.gameState.minions.slice(0, 3).map(m => ({id: m.id, x: m.x, y: m.y, team: m.team, type: m.type})));
            }
            
            const cleanState = this.sanitizeGameState(lobby.gameState);
            this.io.to(player.lobbyId).emit('game_started', {
              gameId: lobby.gameId,
              gameState: cleanState
            });
          } else {
            // Ainda aguardando outros jogadores
            this.io.to(player.lobbyId).emit('player_ready_update', {
              readyCount: lobby.readyPlayers.size,
              totalPlayers: lobby.players.length
            });
          }
        }
      });

      // Desconexão
      socket.on('disconnect', () => {
        const player = this.players.get(socket.id);
        if (player && player.lobbyId) {
          const lobby = this.lobbies.get(player.lobbyId);
          if (lobby) {
            lobby.players = lobby.players.filter(p => p.socketId !== socket.id);
            
            if (lobby.players.length === 0) {
              this.lobbies.delete(player.lobbyId);
            } else {
              this.io.to(player.lobbyId).emit('player_left', {
                player: { username: player.username }
              });
              
              // Notificar sobre jogador saindo do lobby
              this.io.to(player.lobbyId).emit('lobby_player_left', {
                playerId: player.userId
              });
            }
          }
        }
        this.players.delete(socket.id);
        console.log('Cliente desconectado:', socket.id);
      });
    });
  }

  initializeGameState(lobby) {
    // Estado inicial do jogo
    // Mapa do Clash Royale: 1000x700 (atualizado)
    // Inicializar sistema de rounds se não existir
    if (!lobby.currentRound) {
      lobby.currentRound = 1;
      lobby.maxRounds = 3;
      lobby.roundWins = { left: 0, right: 0 };
    }

    const gameState = {
      mapWidth: 1000,
      mapHeight: 700,
      currentRound: lobby.currentRound,
      maxRounds: lobby.maxRounds,
      roundWins: { ...lobby.roundWins },
      status: 'preparing', // preparing, in_game, round_end, game_end
      players: lobby.players.map((player, index) => {
        const gamePlayer = lobby.gameState?.players?.find(p => p.id === player.userId);
        // Manter tropas não posicionadas do round anterior
        const savedTroops = (gamePlayer?.troops?.filter(t => !t.placed) || []).map(t => ({
          ...t,
          placed: false // Resetar flag de posicionamento
        }));
        
        // Se houver apenas 1 jogador, colocar no centro-esquerda
        const isSinglePlayer = lobby.players.length === 1;
        const positionX = isSinglePlayer ? 200 : (index === 0 ? 100 : 900);
        
        return {
          id: player.userId,
          username: player.username,
          position: {
            x: positionX,
            y: 350
          },
          health: 100,
          maxHealth: 100,
          team: index === 0 ? 'left' : 'right',
          lastAttack: 0,
          attackCooldown: 500, // 500ms entre ataques
          coins: gamePlayer?.coins || 100, // Manter moedas do round anterior ou começar com 100
          troops: savedTroops, // Tropas não posicionadas do round anterior
          ready: false // Status de prontidão
        };
      }),
      towers: [
        { id: 'tower_left_1', x: 50, y: 175, health: 100, maxHealth: 100, team: 'left', upgradeLevel: 0, lastAttack: 0, firstAttackDelay: Date.now() + 3000 }, // Delay de 3 segundos antes do primeiro ataque
        { id: 'tower_left_2', x: 50, y: 525, health: 100, maxHealth: 100, team: 'left', upgradeLevel: 0, lastAttack: 0, firstAttackDelay: Date.now() + 3000 },
        { id: 'tower_right_1', x: 950, y: 175, health: 100, maxHealth: 100, team: 'right', upgradeLevel: 0, lastAttack: 0, firstAttackDelay: Date.now() + 3000 },
        { id: 'tower_right_2', x: 950, y: 525, health: 100, maxHealth: 100, team: 'right', upgradeLevel: 0, lastAttack: 0, firstAttackDelay: Date.now() + 3000 }
      ],
      minions: [],
      attacks: [], // Animações de ataque
      projectiles: [], // Projéteis de minions ranged
      coins: [], // Moedas no campo
      lastMinionSpawn: Date.now(),
      minionSpawnInterval: 10000, // Spawn a cada 10 segundos
      lastCoinSpawn: Date.now(),
      coinSpawnInterval: 8000, // Spawn de moeda a cada 8 segundos
      winner: null,
      roundWinner: null, // Vencedor do round atual
      // Sistema de terreno
      terrain: {
        chokepoints: [ // Gargalos (áreas estreitas)
          { x: 475, y: 150, width: 50, height: 120 }, // Gargalo superior
          { x: 475, y: 430, width: 50, height: 120 }  // Gargalo inferior
        ],
        highGround: [ // Terreno elevado (vantagem de altura)
          { x: 200, y: 100, width: 120, height: 100 },
          { x: 680, y: 100, width: 120, height: 100 },
          { x: 200, y: 500, width: 120, height: 100 },
          { x: 680, y: 500, width: 120, height: 100 }
        ],
        cover: [ // Cobertura (reduz dano recebido)
          { x: 150, y: 300, width: 70, height: 70 },
          { x: 780, y: 300, width: 70, height: 70 }
        ]
      }
    };

    // Armazenar estado do jogo no lobby
    lobby.gameState = gameState;
    
    // Iniciar loop do jogo no servidor
    this.startGameLoop(lobby);
    
    return gameState;
  }

  startGameLoop(lobby) {
    console.log(`🎮 Iniciando game loop para lobby ${lobby.id}`);
    let loopCount = 0;
    
    const gameLoop = setInterval(() => {
      loopCount++;
      
      if (!lobby || !lobby.gameState) {
        console.log(`⚠️ Game loop parado: lobby=${!!lobby}, gameState=${!!lobby?.gameState}`);
        clearInterval(gameLoop);
        return;
      }

      // Durante preparação, apenas enviar atualizações de estado (sem lógica de combate)
      if (lobby.status === 'preparing') {
        if (loopCount % 10 === 0) { // A cada 1 segundo (10 * 100ms)
          const cleanState = this.sanitizeGameState(lobby.gameState);
          this.io.to(lobby.id).emit('game_state_update', { gameState: cleanState });
        }
        return; // Não executar lógica de combate durante preparação
      }

      // Só executar lógica de combate quando o jogo estiver ativo
      if (lobby.status !== 'in_game') {
        return;
      }

      const state = lobby.gameState;
      const now = Date.now();

      // Spawn de minions REMOVIDO - agora minions são comprados na loja
      // if (timeSinceLastSpawn >= state.minionSpawnInterval) {
      //   console.log(`⏰ Hora de spawnar! Tempo desde último: ${timeSinceLastSpawn}ms, intervalo: ${state.minionSpawnInterval}ms`);
      //   this.spawnMinions(lobby);
      //   state.lastMinionSpawn = now;
      // }

      // Spawn de moedas REMOVIDO - agora moedas são geradas quando minions morrem
      // const timeSinceLastCoinSpawn = now - state.lastCoinSpawn;
      // if (timeSinceLastCoinSpawn >= state.coinSpawnInterval) {
      //   this.spawnCoins(lobby);
      //   state.lastCoinSpawn = now;
      // }

      // Verificar coleta de moedas
      this.checkCoinCollection(lobby);
      
      // Remover moedas expiradas
      const coinsBefore = state.coins.length;
      state.coins = state.coins.filter(coin => {
        if (coin.collected) return false;
        const age = now - (coin.spawnTime || 0);
        const lifetime = coin.lifetime || 10000;
        if (age >= lifetime) {
          console.log(`⏰ Moeda ${coin.id} expirou após ${Math.floor(age/1000)}s`);
          return false; // Remover moeda expirada
        }
        return true;
      });
      if (coinsBefore !== state.coins.length) {
        console.log(`🧹 ${coinsBefore - state.coins.length} moedas expiradas removidas`);
      }

      // Atualizar projéteis
      this.updateProjectiles(lobby);

      // Atualizar minions
      this.updateMinions(lobby);

      // Ataques das torres (SEMPRE chamar)
      this.updateTowerAttacks(lobby);

      // Atualizar ataques (remover antigos)
      const attacksBefore = state.attacks.length;
      state.attacks = state.attacks.filter(attack => now - attack.timestamp < 300);
      if (attacksBefore !== state.attacks.length) {
        console.log(`🧹 Removidos ${attacksBefore - state.attacks.length} ataques antigos`);
      }

      // Verificar vitória do round
      const roundWinner = this.checkWinner(state);
      if (roundWinner) {
        state.roundWinner = roundWinner;
        this.handleRoundEnd(lobby, roundWinner);
        clearInterval(gameLoop);
        return;
      }

      // Broadcast estado atualizado (remover referências circulares)
      const cleanState = this.sanitizeGameState(state);
      this.io.to(lobby.id).emit('game_state_update', { gameState: cleanState });
    }, 100); // Atualizar a cada 100ms
  }

  spawnMinions(lobby) {
    console.log(`\n🔵 INICIANDO SPAWN DE MINIONS`);
    const state = lobby.gameState;
    if (!state) {
      console.log(`❌ ERRO: gameState não existe!`);
      return;
    }
    
    console.log(`📊 Estado atual: ${state.minions.length} minions existentes`);
    
    const now = Date.now();
    
    // Calcular dano baseado no upgradeLevel da torre do time LEFT
    const leftTowers = state.towers.filter(t => t.team === 'left');
    const leftUpgradeLevel = leftTowers.length > 0 ? Math.max(...leftTowers.map(t => t.upgradeLevel || 0)) : 0;
    const leftMinionDamage = 1 + (leftUpgradeLevel * 2); // Nível 0 = 1, nível 1 = 3, nível 2 = 5, etc.
    
    // Calcular dano baseado no upgradeLevel da torre do time RIGHT
    const rightTowers = state.towers.filter(t => t.team === 'right');
    const rightUpgradeLevel = rightTowers.length > 0 ? Math.max(...rightTowers.map(t => t.upgradeLevel || 0)) : 0;
    const rightMinionDamage = 1 + (rightUpgradeLevel * 2); // Nível 0 = 1, nível 1 = 3, nível 2 = 5, etc.

    // Spawn minions para cada torre de cada time
    // Torres LEFT estão em y: 200 e y: 400
    // Torres RIGHT estão em y: 200 e y: 400
    
    // Spawn minions do time LEFT (5 melee + 1 ranged para cada torre)
    leftTowers.forEach((tower, towerIndex) => {
      // Tamanho maior para melhor visualização
      const minionSize = 24;
      
      // Vida baseada no upgradeLevel (base: 20, +10 por nível)
      const minionHealth = 20 + (leftUpgradeLevel * 10);
      const minionMaxHealth = minionHealth;
      
      // Spawnar 5 minions melee (soco) por torre
      for (let i = 0; i < 5; i++) {
        // Pequena variação na posição Y para não spawnarem todos no mesmo lugar
        const yOffset = (i - 2) * 8; // -16, -8, 0, 8, 16
        
        const leftMinion = {
          id: `minion_${now}_left_${towerIndex}_${i}_${Math.random().toString(36).substr(2, 5)}`,
          x: 120,
          y: tower.y + yOffset, // Spawnar próximo à torre com pequena variação
          team: 'left',
          type: 'melee', // Tipo: melee (soco)
          health: minionHealth,
          maxHealth: minionMaxHealth,
          speed: 2.5,
          targetTower: null,
          targetMinion: null,
          damage: leftMinionDamage,
          lastAttack: 0,
          attackCooldown: 1500, // Aumentado de 600ms para 1500ms (mais lento)
          lastAttackAnimation: 0,
          size: minionSize, // Tamanho fixo
          upgradeLevel: leftUpgradeLevel // Nível de upgrade
        };
        state.minions.push(leftMinion);
        console.log(`✅ Minion LEFT (melee) criado: ${leftMinion.id} em (${leftMinion.x}, ${leftMinion.y}) próximo à torre ${tower.id} com dano ${leftMinionDamage}, HP ${minionHealth} (nível ${leftUpgradeLevel})`);
      }
      
      // Spawnar 1 minion ranged (atirador) por torre
      const rangedMinion = {
        id: `minion_ranged_${now}_left_${towerIndex}_${Math.random().toString(36).substr(2, 5)}`,
        x: 120,
        y: tower.y, // Spawnar próximo à torre
        team: 'left',
        type: 'ranged', // Tipo: ranged (atirador)
        health: minionHealth,
        maxHealth: minionMaxHealth,
        speed: 2.0, // Um pouco mais lento que melee
        targetTower: null,
        targetMinion: null,
        targetPlayer: null,
        damage: leftMinionDamage,
        lastAttack: 0,
        attackCooldown: 2500, // Aumentado de 1000ms para 2500ms (mais lento)
        lastAttackAnimation: 0,
        attackRange: 120, // Alcance de ataque à distância
        size: minionSize, // Tamanho fixo
        upgradeLevel: leftUpgradeLevel // Nível de upgrade
      };
      state.minions.push(rangedMinion);
      console.log(`✅ Minion LEFT (ranged) criado: ${rangedMinion.id} em (${rangedMinion.x}, ${rangedMinion.y}) próximo à torre ${tower.id} com dano ${leftMinionDamage}, HP ${minionHealth} (nível ${leftUpgradeLevel})`);
    });
    
    // Spawn minions do time RIGHT (5 melee + 1 ranged para cada torre)
    rightTowers.forEach((tower, towerIndex) => {
      // Tamanho maior para melhor visualização
      const minionSize = 24;
      
      // Vida baseada no upgradeLevel (base: 20, +10 por nível)
      const rightMinionHealth = 20 + (rightUpgradeLevel * 10);
      const rightMinionMaxHealth = rightMinionHealth;
      
      // Spawnar 5 minions melee (soco) por torre
      for (let i = 0; i < 5; i++) {
        // Pequena variação na posição Y para não spawnarem todos no mesmo lugar
        const yOffset = (i - 2) * 8; // -16, -8, 0, 8, 16
        
        const rightMinion = {
          id: `minion_${now}_right_${towerIndex}_${i}_${Math.random().toString(36).substr(2, 5)}`,
          x: 880,
          y: tower.y + yOffset, // Spawnar próximo à torre com pequena variação
          team: 'right',
          type: 'melee', // Tipo: melee (soco)
          health: rightMinionHealth,
          maxHealth: rightMinionMaxHealth,
          speed: 2.5,
          targetTower: null,
          targetMinion: null,
          damage: rightMinionDamage,
          lastAttack: 0,
          attackCooldown: 1500, // Aumentado de 600ms para 1500ms (mais lento)
          lastAttackAnimation: 0,
          size: minionSize, // Tamanho fixo
          upgradeLevel: rightUpgradeLevel // Nível de upgrade
        };
        state.minions.push(rightMinion);
        console.log(`✅ Minion RIGHT (melee) criado: ${rightMinion.id} em (${rightMinion.x}, ${rightMinion.y}) próximo à torre ${tower.id} com dano ${rightMinionDamage}, HP ${rightMinionHealth} (nível ${rightUpgradeLevel})`);
      }
      
      // Spawnar 1 minion ranged (atirador) por torre
      const rangedMinion = {
        id: `minion_ranged_${now}_right_${towerIndex}_${Math.random().toString(36).substr(2, 5)}`,
        x: 880,
        y: tower.y, // Spawnar próximo à torre
        team: 'right',
        type: 'ranged', // Tipo: ranged (atirador)
        health: rightMinionHealth,
        maxHealth: rightMinionMaxHealth,
        speed: 2.0, // Um pouco mais lento que melee
        targetTower: null,
        targetMinion: null,
        targetPlayer: null,
        damage: rightMinionDamage,
        lastAttack: 0,
        attackCooldown: 2500, // Aumentado de 1000ms para 2500ms (mais lento)
        lastAttackAnimation: 0,
        attackRange: 120, // Alcance de ataque à distância
        size: minionSize, // Tamanho fixo
        upgradeLevel: rightUpgradeLevel // Nível de upgrade
      };
      state.minions.push(rangedMinion);
      console.log(`✅ Minion RIGHT (ranged) criado: ${rangedMinion.id} em (${rangedMinion.x}, ${rangedMinion.y}) próximo à torre ${tower.id} com dano ${rightMinionDamage}, HP ${rightMinionHealth} (nível ${rightUpgradeLevel})`);
    });
    
    console.log(`🎯 Total de minions após spawn: ${state.minions.length}`);
    console.log(`📋 Minions:`, state.minions.map(m => `${m.team}(${m.id})`).join(', '));
  }

  updateProjectiles(lobby) {
    const state = lobby.gameState;
    if (!state || !state.projectiles) return;
    
    const now = Date.now();
    const projectilesToRemove = [];
    
    // Log para debug
    const arrowCount = state.projectiles.filter(p => p.type === 'arrow_special').length;
    if (arrowCount > 0) {
      console.log(`🏹 Atualizando ${arrowCount} flecha(s) especial(is)`);
    }
    
    state.projectiles.forEach(projectile => {
      // Flecha especial se move em linha reta
      if (projectile.type === 'arrow_special') {
        console.log(`🏹 Processando flecha especial ${projectile.id} em (${projectile.x.toFixed(1)}, ${projectile.y.toFixed(1)})`);
        // Calcular distância percorrida
        const distanceTraveled = Math.hypot(
          projectile.x - projectile.startX,
          projectile.y - projectile.startY
        );
        
        // Verificar se ultrapassou distância máxima ou saiu do mapa
        const mapWidth = state.mapWidth || 1000;
        const mapHeight = state.mapHeight || 700;
        const outOfBounds = projectile.x < 0 || projectile.x > mapWidth || 
                           projectile.y < 0 || projectile.y > mapHeight;
        
        if (distanceTraveled >= projectile.maxDistance || outOfBounds) {
          // Flecha atingiu limite ou saiu do mapa, causar dano em área
          console.log(`🏹 Flecha especial atingiu limite ou saiu do mapa em (${projectile.x.toFixed(1)}, ${projectile.y.toFixed(1)})`);
          this.applyArrowAreaDamage(state, projectile, now);
          projectilesToRemove.push(projectile.id);
        } else {
          // Verificar colisão com objetos
          let hitSomething = false;
          
          // Verificar colisão com minions inimigos
          state.minions.forEach(minion => {
            if (minion.team === projectile.team || minion.health <= 0) return;
            const dist = Math.hypot(projectile.x - minion.x, projectile.y - minion.y);
            const minionRadius = (minion.size || 16) / 2;
            if (dist < minionRadius + 10) { // Raio de colisão considerando tamanho do minion
              hitSomething = true;
              console.log(`🏹 Flecha especial colidiu com minion ${minion.id} em (${projectile.x.toFixed(1)}, ${projectile.y.toFixed(1)}), distância: ${dist.toFixed(1)}`);
            }
          });
          
          // Verificar colisão com jogadores inimigos
          if (!hitSomething) {
            state.players.forEach(target => {
              if (target.team === projectile.team || target.health <= 0) return;
              const dist = Math.hypot(projectile.x - target.position.x, projectile.y - target.position.y);
              if (dist < 25) {
                hitSomething = true;
                console.log(`🏹 Flecha especial colidiu com jogador ${target.username} em (${projectile.x.toFixed(1)}, ${projectile.y.toFixed(1)})`);
              }
            });
          }
          
          // Verificar colisão com torres inimigas
          if (!hitSomething) {
            state.towers.forEach(tower => {
              if (tower.team === projectile.team || tower.health <= 0) return;
              const dist = Math.hypot(projectile.x - tower.x, projectile.y - tower.y);
              if (dist < 30) {
                hitSomething = true;
              }
            });
          }
          
          if (hitSomething) {
            // Flecha colidiu, causar dano em área
            console.log(`🏹 Flecha especial colidiu em (${projectile.x.toFixed(1)}, ${projectile.y.toFixed(1)})`);
            this.applyArrowAreaDamage(state, projectile, now);
            projectilesToRemove.push(projectile.id);
          } else {
            // Mover flecha em linha reta
            const oldX = projectile.x;
            const oldY = projectile.y;
            projectile.x += projectile.directionX * projectile.speed;
            projectile.y += projectile.directionY * projectile.speed;
            // Log a cada 10 frames para debug
            if (Math.random() < 0.1) {
              console.log(`🏹 Flecha especial movendo: (${oldX.toFixed(1)}, ${oldY.toFixed(1)}) → (${projectile.x.toFixed(1)}, ${projectile.y.toFixed(1)})`);
            }
          }
        }
      } else {
        // Projétil normal (seguindo alvo)
        const dx = projectile.targetX - projectile.x;
        const dy = projectile.targetY - projectile.y;
        const distance = Math.hypot(dx, dy);
        
        if (distance < 5) {
          // Projétil chegou ao alvo, aplicar dano
          if (projectile.targetType === 'player') {
            const target = state.players.find(p => p.id === projectile.targetId);
            if (target && target.health > 0) {
              const oldHealth = target.health;
              target.health = Math.max(0, target.health - projectile.damage);
              
              // Criar floating damage text
              if (!state.damageTexts) state.damageTexts = [];
              state.damageTexts.push({
                id: `damage_${now}_${target.id}_projectile`,
                x: projectile.targetX,
                y: projectile.targetY,
                value: projectile.damage,
                timestamp: now,
                isSpecial: false
              });
              
              console.log(`💥 Projétil acertou jogador ${target.username}! HP: ${oldHealth} → ${target.health}`);
            }
          } else {
            const target = state.minions.find(m => m.id === projectile.targetId);
            if (target && target.health > 0) {
              const oldHealth = target.health;
              const damageResult = this.applyDamageToMinion(target, projectile.damage);
              
              // Criar floating damage text
              if (!state.damageTexts) state.damageTexts = [];
              state.damageTexts.push({
                id: `damage_${now}_${target.id}_projectile`,
                x: projectile.targetX,
                y: projectile.targetY,
                value: projectile.damage,
                timestamp: now,
                isSpecial: false
              });
              
              // Rastrear quem causou o dano
              target.lastDamagedBy = {
                type: 'minion',
                minionId: 'ranged',
                team: projectile.team
              };
              
              // Se o minion morreu, dar moeda
              if (target.health <= 0 && oldHealth > 0) {
                const killerPlayer = state.players.find(p => p.team === projectile.team);
                if (killerPlayer) {
                  killerPlayer.coins = (killerPlayer.coins || 0) + 1;
                  console.log(`💰 Jogador ${killerPlayer.username} ganhou 1 moeda por minion ranged matar! Total: ${killerPlayer.coins}`);
                }
              }
              
              console.log(`💥 Projétil acertou minion ${target.id}! HP: ${oldHealth} → ${target.health}`);
            }
          }
          projectilesToRemove.push(projectile.id);
        } else {
          // Mover projétil em direção ao alvo
          const moveDistance = projectile.speed;
          projectile.x += (dx / distance) * moveDistance;
          projectile.y += (dy / distance) * moveDistance;
        }
      }
    });
    
    // Remover projéteis que chegaram ao alvo ou expiraram
    state.projectiles = state.projectiles.filter(p => {
      if (projectilesToRemove.includes(p.id)) return false;
      const age = now - p.timestamp;
      return age < 5000; // Remover após 5 segundos
    });
  }

  // Aplicar dano em área da flecha especial
  applyArrowAreaDamage(state, arrow, now) {
    console.log(`🏹💥 Aplicando dano em área da flecha especial em (${arrow.x.toFixed(1)}, ${arrow.y.toFixed(1)}), raio: ${arrow.radius}, dano: ${arrow.damage}`);
    const hits = [];
    
    // Verificar minions inimigos
    if (state.minions && state.minions.length > 0) {
      state.minions.forEach(minion => {
        if (minion.team === arrow.team || minion.health <= 0) return;
        const dist = Math.hypot(arrow.x - minion.x, arrow.y - minion.y);
        console.log(`   Verificando minion ${minion.id} (${minion.team}): distância=${dist.toFixed(1)}, raio=${arrow.radius}, dentro=${dist <= arrow.radius}`);
        if (dist <= arrow.radius) {
          const oldHealth = minion.health;
          const damageResult = this.applyDamageToMinion(minion, arrow.damage);
          hits.push({ type: 'minion', id: minion.id, oldHealth, newHealth: minion.health });
          
          // Criar floating damage text
          if (!state.damageTexts) state.damageTexts = [];
          state.damageTexts.push({
            id: `damage_${now}_${minion.id}_arrow`,
            x: minion.x,
            y: minion.y,
            value: arrow.damage,
            timestamp: now,
            isSpecial: true
          });
          
          console.log(`🏹💥✅ Flecha especial acertou minion ${minion.id}! HP: ${oldHealth} → ${minion.health}`);
        }
      });
    } else {
      console.log(`   Nenhum minion encontrado para verificar`);
    }
    
    // Verificar jogadores inimigos
    state.players.forEach(target => {
      if (target.team === arrow.team || target.health <= 0) return;
      const dist = Math.hypot(arrow.x - target.position.x, arrow.y - target.position.y);
      if (dist <= arrow.radius) {
        const oldHealth = target.health;
        target.health = Math.max(0, target.health - arrow.damage);
        hits.push({ type: 'player', id: target.id, oldHealth, newHealth: target.health });
        
        // Criar floating damage text
        if (!state.damageTexts) state.damageTexts = [];
        state.damageTexts.push({
          id: `damage_${now}_${target.id}_arrow`,
          x: target.position.x,
          y: target.position.y,
          value: arrow.damage,
          timestamp: now,
          isSpecial: true
        });
        
        console.log(`🏹💥 Flecha especial acertou jogador ${target.username}! HP: ${oldHealth} → ${target.health}`);
        
        // Verificar se o jogador morreu
        if (target.health <= 0) {
          console.log(`💀 Jogador ${target.username} morreu por flecha especial!`);
          const winner = this.checkWinner(state);
          if (winner) {
            state.winner = winner;
            this.io.to(state.players.find(p => p.team === arrow.team)?.lobbyId || '').emit('game_over', { winner });
          }
        }
      }
    });
    
    // Verificar torres inimigas
    state.towers.forEach(tower => {
      if (tower.team === arrow.team || tower.health <= 0) return;
      const dist = Math.hypot(arrow.x - tower.x, arrow.y - tower.y);
      if (dist <= arrow.radius) {
        const oldHealth = tower.health;
        tower.health = Math.max(0, tower.health - arrow.damage);
        hits.push({ type: 'tower', id: tower.id, oldHealth, newHealth: tower.health });
        
        // Criar floating damage text
        if (!state.damageTexts) state.damageTexts = [];
        state.damageTexts.push({
          id: `damage_${now}_${tower.id}_arrow`,
          x: tower.x,
          y: tower.y,
          value: arrow.damage,
          timestamp: now,
          isSpecial: true
        });
        
        console.log(`🏹💥 Flecha especial acertou torre ${tower.id}! HP: ${oldHealth} → ${tower.health}`);
      }
    });
    
    console.log(`🏹💥 Flecha especial explodiu! ${hits.length} alvos atingidos com dano de ${arrow.damage}`);
  }

  // Função helper para aplicar dano considerando defesa
  // Função para verificar colisão com torres
  checkTowerCollision(x, y, state) {
    if (!state || !state.towers) return false;
    
    const towerSize = 30; // Raio de colisão da torre (metade do tamanho visual de 60)
    const entitySize = 18; // Tamanho do jogador/minion
    
    for (const tower of state.towers) {
      if (tower.health <= 0) continue; // Torres destruídas não têm colisão
      
      const distance = Math.hypot(tower.x - x, tower.y - y);
      if (distance < towerSize + entitySize) {
        return true; // Colisão detectada
      }
    }
    
    return false; // Sem colisão
  }

  // Função para encontrar a ponte mais próxima para atravessar o rio
  findNearestBridge(x, y, targetX, targetY) {
    const mapWidth = 1000;
    const mapHeight = 700;
    const riverCenterX = mapWidth / 2; // 500
    const bridgeWidth = 120;
    const bridgeLeft = riverCenterX - bridgeWidth / 2; // 440
    const bridgeRight = riverCenterX + bridgeWidth / 2; // 560
    const bridgeHeight = 15;
    
    // Ponte superior
    const topBridgeY = 200;
    const topBridgeCenterY = topBridgeY + bridgeHeight / 2; // 207.5
    
    // Ponte inferior
    const bottomBridgeY = mapHeight - 200 - bridgeHeight; // 485
    const bottomBridgeCenterY = bottomBridgeY + bridgeHeight / 2; // 492.5
    
    // Calcular distância até cada ponte
    const distToTopBridge = Math.hypot(x - riverCenterX, y - topBridgeCenterY);
    const distToBottomBridge = Math.hypot(x - riverCenterX, y - bottomBridgeCenterY);
    
    // Escolher a ponte mais próxima
    let nearestBridge = null;
    if (distToTopBridge < distToBottomBridge) {
      nearestBridge = { x: riverCenterX, y: topBridgeCenterY, bridgeY: topBridgeY };
    } else {
      nearestBridge = { x: riverCenterX, y: bottomBridgeCenterY, bridgeY: bottomBridgeY };
    }
    
    return nearestBridge;
  }

  // Função para verificar se precisa atravessar o rio para chegar ao alvo
  needsToCrossRiver(currentX, currentY, targetX, targetY) {
    const mapWidth = 1000;
    const riverCenterX = mapWidth / 2; // 500
    const riverWidth = 80;
    const riverLeft = riverCenterX - riverWidth / 2; // 460
    const riverRight = riverCenterX + riverWidth / 2; // 540
    
    // Verificar se o minion e o alvo estão em lados opostos do rio
    const currentOnLeft = currentX < riverLeft;
    const currentOnRight = currentX > riverRight;
    const targetOnLeft = targetX < riverLeft;
    const targetOnRight = targetX > riverRight;
    
    // Se estão em lados opostos, precisa atravessar
    return (currentOnLeft && targetOnRight) || (currentOnRight && targetOnLeft);
  }

  // Função para verificar se pode atravessar o rio (só pelas pontes)
  // LÓGICA: Verifica se o caminho passa pelo rio. Se passar, DEVE estar na ponte.
  canCrossRiver(currentX, currentY, newX, newY) {
    const mapWidth = 1000;
    const mapHeight = 700;
    const RIVER_CENTER_X = mapWidth / 2; // 500
    const RIVER_WIDTH = 80;
    const RIVER_LEFT = RIVER_CENTER_X - RIVER_WIDTH / 2; // 460
    const RIVER_RIGHT = RIVER_CENTER_X + RIVER_WIDTH / 2; // 540
    
    const BRIDGE_WIDTH = 120;
    const BRIDGE_HEIGHT = 15;
    const BRIDGE_LEFT = RIVER_CENTER_X - BRIDGE_WIDTH / 2; // 440
    const BRIDGE_RIGHT = RIVER_CENTER_X + BRIDGE_WIDTH / 2; // 560
    
    const TOP_BRIDGE_Y = 200;
    const BOTTOM_BRIDGE_Y = mapHeight - 200 - BRIDGE_HEIGHT; // 485
    
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
    const pathCrossesRiver = (minX <= RIVER_RIGHT && maxX >= RIVER_LEFT);
    
    // Se o caminho NÃO passa pelo rio, permitir movimento livre
    if (!pathCrossesRiver) {
      return true;
    }
    
    // O caminho PASSA pelo rio, então DEVE estar em uma ponte
    // Verificar se o caminho está dentro da área de uma ponte (com tolerância)
    
    // Ponte superior: Y entre 195-220 E X entre 440-560
    const onTopBridge = (minY <= topBridgeYEnd && maxY >= topBridgeYStart && 
                        minX <= BRIDGE_RIGHT && maxX >= BRIDGE_LEFT);
    
    // Ponte inferior: Y entre 480-505 E X entre 440-560
    const onBottomBridge = (minY <= bottomBridgeYEnd && maxY >= bottomBridgeYStart && 
                            minX <= BRIDGE_RIGHT && maxX >= BRIDGE_LEFT);
    
    // Se está em alguma ponte, PERMITIR
    if (onTopBridge || onBottomBridge) {
      return true;
    }
    
    // O caminho passa pelo rio mas NÃO está em uma ponte, BLOQUEAR
    return false;
  }

  applyDamageToMinion(minion, damage) {
    const oldShield = minion.defenseShield || 0;
    const oldHealth = minion.health || 0;
    
    // IMPORTANTE: O escudo é uma barra SEPARADA da vida
    // Quando o escudo acaba, o minion ainda deve ter sua vida normal
    
    // Se o minion tem escudo de defesa, reduzir escudo primeiro
    if (minion.defenseShield && minion.defenseShield > 0) {
      if (damage <= minion.defenseShield) {
        // Todo o dano é absorvido pelo escudo - NÃO afeta a vida de forma alguma
        minion.defenseShield = Math.max(0, minion.defenseShield - damage);
        // Garantir que a vida permanece inalterada
        minion.health = oldHealth; // Forçar manter a vida original
        return { shieldDamage: damage, healthDamage: 0 };
      } else {
        // Escudo é destruído e o dano restante vai para a vida
        const remainingDamage = damage - minion.defenseShield;
        minion.defenseShield = 0;
        // Aplicar apenas o dano restante à vida, NUNCA zerar a vida quando o escudo acaba
        minion.health = Math.max(0, oldHealth - remainingDamage);
        return { shieldDamage: oldShield, healthDamage: remainingDamage };
      }
    } else {
      // Sem escudo, dano vai direto para a vida
      minion.health = Math.max(0, minion.health - damage);
      return { shieldDamage: 0, healthDamage: damage };
    }
  }

  updateTowerAttacks(lobby) {
    const state = lobby.gameState;
    if (!state || !state.towers) {
      console.log('⚠️ updateTowerAttacks: state ou towers não existe');
      return;
    }

    const now = Date.now();
    const towerAttackRange = 350; // Raio de ataque da torre (aumentado para garantir)
    const towerAttackDamage = 10; // Dano da torre (reduzido em 50% para dar mais jogo)
    const towerAttackCooldown = 1500; // 1.5 segundos entre ataques (mais rápido)

    state.towers.forEach(tower => {
      // Apenas torres vivas atacam
      if (tower.health <= 0) {
        // console.log(`⏭️ Torre ${tower.id} está morta, pulando`);
        return;
      }

      // Inicializar lastAttack se não existir
      if (!tower.lastAttack) tower.lastAttack = 0;
      
      // Inicializar firstAttackDelay se não existir (delay de 3 segundos antes do primeiro ataque)
      if (!tower.firstAttackDelay) tower.firstAttackDelay = Date.now() + 3000;

      // Verificar delay inicial (dar tempo dos minions chegarem)
      if (now < tower.firstAttackDelay) {
        // console.log(`⏳ Torre ${tower.id} aguardando delay inicial: ${Math.ceil((tower.firstAttackDelay - now) / 1000)}s restantes`);
        return;
      }

      // Verificar cooldown
      const timeSinceLastAttack = now - tower.lastAttack;
      if (timeSinceLastAttack < towerAttackCooldown) {
        // console.log(`⏳ Torre ${tower.id} em cooldown: ${timeSinceLastAttack}ms / ${towerAttackCooldown}ms`);
        return;
      }

      // Torres atacam minions (prioridade) e jogadores
      let closestMinion = null;
      let closestMinionDistance = Infinity;
      let closestPlayer = null;
      let closestPlayerDistance = Infinity;

      // Procurar minions inimigos primeiro (prioridade)
      if (state.minions) {
        state.minions.forEach(minion => {
          // Ignorar minions do mesmo time ou mortos
          if (minion.team === tower.team || minion.health <= 0) return;

          const distance = Math.hypot(
            minion.x - tower.x,
            minion.y - tower.y
          );

          if (distance <= towerAttackRange && distance < closestMinionDistance) {
            closestMinionDistance = distance;
            closestMinion = minion;
          }
        });
      }

      // Procurar jogadores inimigos
      if (state.players) {
        state.players.forEach(player => {
          // Ignorar jogadores do mesmo time ou mortos
          if (player.team === tower.team || player.health <= 0) return;

          const distance = Math.hypot(
            player.position.x - tower.x,
            player.position.y - tower.y
          );

          if (distance <= towerAttackRange && distance < closestPlayerDistance) {
            closestPlayerDistance = distance;
            closestPlayer = player;
          }
        });
      }

      // Priorizar minions sobre jogadores
      let target = null;
      let targetType = null;
      let targetDistance = Infinity;

      if (closestMinion) {
        target = closestMinion;
        targetType = 'minion';
        targetDistance = closestMinionDistance;
        console.log(`🎯 Torre ${tower.id} escolheu MINION ${closestMinion.id} como alvo a ${targetDistance.toFixed(1)}px`);
      } else if (closestPlayer) {
        target = closestPlayer;
        targetType = 'player';
        targetDistance = closestPlayerDistance;
        console.log(`🎯 Torre ${tower.id} escolheu JOGADOR ${closestPlayer.username} como alvo a ${targetDistance.toFixed(1)}px`);
      }

      if (target) {
        tower.lastAttack = now;

        // Coordenadas do alvo
        let targetX, targetY;
        if (targetType === 'minion') {
          targetX = target.x;
          targetY = target.y;
        } else {
          targetX = target.position.x;
          targetY = target.position.y;
        }

        // Calcular dano: 1/4 da vida máxima do alvo
        let towerAttackDamage;
        if (targetType === 'minion') {
          // Dano = 1/4 da vida máxima do minion
          towerAttackDamage = Math.ceil(target.maxHealth / 4);
        } else {
          // Para jogadores, manter dano fixo
          towerAttackDamage = 10;
        }

        // Criar ataque da torre
        const towerAttack = {
          id: `tower_attack_${tower.id}_${now}`,
          towerId: tower.id,
          x: tower.x,
          y: tower.y,
          targetX: targetX,
          targetY: targetY,
          team: tower.team,
          timestamp: now,
          damage: towerAttackDamage,
          targetType: targetType,
          targetId: target.id
        };

        state.attacks.push(towerAttack);

        // Aplicar dano imediatamente
        const oldHealth = target.health;
        target.health = Math.max(0, target.health - towerAttackDamage);
        
        // Criar floating damage text
        if (!state.damageTexts) state.damageTexts = [];
        state.damageTexts.push({
          id: `damage_${now}_${target.id}_tower`,
          x: targetType === 'minion' ? target.x : target.position.x,
          y: targetType === 'minion' ? target.y : target.position.y,
          value: towerAttackDamage,
          timestamp: now,
          isSpecial: true,
          isTowerAttack: true
        });

        if (targetType === 'minion') {
          console.log(`🏰 Torre ${tower.id} atacou MINION ${target.id}! HP: ${oldHealth} → ${target.health} (dano: ${towerAttackDamage}, 1/4 da vida máxima) (distância: ${targetDistance.toFixed(1)}px)`);
          
          // Se o minion morreu, dar moeda ao jogador do time da torre
          if (target.health <= 0 && oldHealth > 0) {
            const towerPlayer = state.players.find(p => p.team === tower.team);
            if (towerPlayer) {
              towerPlayer.coins = (towerPlayer.coins || 0) + 1;
              console.log(`💰 Jogador ${towerPlayer.username} ganhou 1 moeda por torre matar minion! Total: ${towerPlayer.coins}`);
            }
          }
        } else {
          console.log(`🏰 Torre ${tower.id} atacou ${target.username}! HP: ${oldHealth} → ${target.health} (distância: ${targetDistance.toFixed(1)}px)`);
          
          // Verificar se o jogador morreu
          if (target.health <= 0) {
            console.log(`💀 Jogador ${target.username} morreu por ataque da torre!`);
            const winner = this.checkWinner(state);
            if (winner) {
              state.winner = winner;
              const lobby = this.lobbies.get(Array.from(this.lobbies.values()).find(l => l.gameState === state)?.id);
              if (lobby) {
                this.io.to(lobby.id).emit('game_over', { winner });
              }
            }
          }
        }
      }
    });
  }

  // Função auxiliar para verificar se está em terreno elevado
  isOnHighGround(x, y, terrain) {
    if (!terrain || !terrain.highGround) return false;
    return terrain.highGround.some(area => 
      x >= area.x && x <= area.x + area.width &&
      y >= area.y && y <= area.y + area.height
    );
  }

  // Função auxiliar para verificar se está em cobertura
  isInCover(x, y, terrain) {
    if (!terrain || !terrain.cover) return false;
    return terrain.cover.some(area => 
      x >= area.x && x <= area.x + area.width &&
      y >= area.y && y <= area.y + area.height
    );
  }

  // Função auxiliar para verificar se está em gargalo
  isInChokepoint(x, y, terrain) {
    if (!terrain || !terrain.chokepoints) return false;
    return terrain.chokepoints.some(area => 
      x >= area.x && x <= area.x + area.width &&
      y >= area.y && y <= area.y + area.height
    );
  }

  updateMinions(lobby) {
    const state = lobby.gameState;
    if (!state || !state.minions) return;
    
    const now = Date.now();
    
    // Obter comando tático do jogador de cada time
    const leftPlayer = state.players.find(p => p.team === 'left');
    const rightPlayer = state.players.find(p => p.team === 'right');
    
    state.minions.forEach(minion => {
      // Inicializar propriedades se não existirem
      if (!minion.lastPosition) minion.lastPosition = { x: minion.x, y: minion.y };
      if (minion.stationaryTime === undefined) minion.stationaryTime = 0;
      if (minion.specialAttackReady === undefined) minion.specialAttackReady = false;

      // Verificar movimento (para habilidade especial do arqueiro)
      const moved = Math.hypot(minion.x - minion.lastPosition.x, minion.y - minion.lastPosition.y) > 2;
      if (moved) {
        minion.stationaryTime = 0;
        minion.specialAttackReady = false;
      } else {
        minion.stationaryTime += 100; // Incrementar a cada loop (100ms)
        // Arqueiro fica pronto para tiro especial após 3 segundos parado
        if (minion.type === 'ranged' && minion.stationaryTime >= 3000) {
          minion.specialAttackReady = true;
        }
      }
      minion.lastPosition = { x: minion.x, y: minion.y };

      // Obter comando tático do jogador do time
      const playerCommand = minion.team === 'left' 
        ? (leftPlayer?.tacticalCommand || null)
        : (rightPlayer?.tacticalCommand || null);
      const commandAge = playerCommand 
        ? (now - (minion.team === 'left' ? leftPlayer?.tacticalCommandTime : rightPlayer?.tacticalCommandTime || 0))
        : Infinity;

      // Aplicar comandos táticos (válidos por 10 segundos)
      let tacticalModifier = { speed: 1, aggression: 1, focus: null, protect: false };
      if (playerCommand && commandAge < 10000) {
        switch (playerCommand) {
          case 'advance':
            tacticalModifier.speed = 1.5;
            tacticalModifier.aggression = 1.3;
            break;
          case 'hold':
            tacticalModifier.speed = 0.3;
            tacticalModifier.aggression = 0.5;
            break;
          case 'retreat':
            tacticalModifier.speed = 1.2;
            tacticalModifier.aggression = 0.3;
            // Mover em direção à torre aliada
            const retreatTowers = state.towers.filter(t => t.team === minion.team && t.health > 0);
            if (retreatTowers.length > 0) {
              const closestRetreatTower = retreatTowers.reduce((closest, tower) => {
                const dist = Math.hypot(minion.x - tower.x, minion.y - tower.y);
                const closestDist = Math.hypot(minion.x - closest.x, minion.y - closest.y);
                return dist < closestDist ? tower : closest;
              });
              tacticalModifier.focus = { x: closestRetreatTower.x, y: closestRetreatTower.y };
            }
            break;
          case 'focus':
            // Focar no alvo mais próximo
            tacticalModifier.focus = null; // Será calculado abaixo
            tacticalModifier.aggression = 1.5;
            break;
          case 'protect':
            // Proteger arqueiros (melee fica perto de ranged)
            if (minion.type === 'melee') {
              const nearbyRanged = allyMinions.filter(ally => 
                ally.type === 'ranged' && 
                Math.hypot(minion.x - ally.x, minion.y - ally.y) <= 100
              );
              if (nearbyRanged.length > 0) {
                const closestRanged = nearbyRanged.reduce((closest, ranged) => {
                  const dist = Math.hypot(minion.x - ranged.x, minion.y - ranged.y);
                  const closestDist = Math.hypot(minion.x - closest.x, minion.y - closest.y);
                  return dist < closestDist ? ranged : closest;
                });
                tacticalModifier.focus = { x: closestRanged.x, y: closestRanged.y };
                tacticalModifier.protect = true;
              }
            }
            break;
          case 'stop':
            // Parar todas as tropas completamente
            tacticalModifier.speed = 0;
            tacticalModifier.aggression = 0;
            break;
          case 'defend':
            // Defender (somente guerreiros) - ficam em posição defensiva PARADOS
            if (minion.type === 'melee') {
              tacticalModifier.speed = 0; // Completamente parado
              tacticalModifier.aggression = 0.8; // Ainda atacam, mas com menos agressividade
              // Não mover - ficar exatamente onde está para defender
              // Ativar escudo de defesa
              if (!minion.defenseShield) {
                minion.defenseShield = minion.maxHealth * 0.5; // Escudo = 50% da vida máxima
                minion.maxDefenseShield = minion.defenseShield;
              }
            } else {
              // Arqueiros ignoram comando de defender
              tacticalModifier.speed = 1;
              tacticalModifier.aggression = 1;
            }
            break;
        }
      }

      // Se for comando de defender, NÃO mover - ficar completamente parado
      if (playerCommand === 'defend' && minion.type === 'melee') {
        // Não fazer nada - ficar parado onde está
        // Mas ainda pode atacar inimigos próximos (lógica abaixo)
      } else if (tacticalModifier.focus && tacticalModifier.focus.x !== undefined && tacticalModifier.focus.y !== undefined) {
        // Verificar se há foco tático definido (retreat, protect) - mas NÃO para defend
        const focusX = tacticalModifier.focus.x;
        const focusY = tacticalModifier.focus.y;
        const dx = focusX - minion.x;
        const dy = focusY - minion.y;
        const distance = Math.hypot(dx, dy);
        
        // Se ainda não chegou ao foco, mover em direção a ele
        if (distance > 30) {
          let finalSpeed = minion.speed * tacticalModifier.speed;
          if (this.isOnHighGround(minion.x, minion.y, state.terrain)) {
            finalSpeed *= 1.2;
          }
          if (this.isInChokepoint(minion.x, minion.y, state.terrain)) {
            finalSpeed *= 0.7;
          }
          
          const moveX = (dx / distance) * finalSpeed;
          const moveY = (dy / distance) * finalSpeed;
          const newX = minion.x + moveX;
          const newY = minion.y + moveY;
          if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
            minion.x = newX;
            minion.y = newY;
          }
          
          // Para outros comandos com foco (retreat, protect), apenas mover em direção ao foco
          if (playerCommand === 'retreat' || playerCommand === 'protect') {
            return; // Apenas mover em direção ao foco
          }
        }
      }
      
      // Prioridade de alvos: 1) Jogador inimigo, 2) Minion inimigo, 3) Torre inimiga
      
      // 1. Verificar se há jogador inimigo próximo (prioridade máxima)
      const enemyPlayers = state.players.filter(p => 
        p.team !== minion.team && 
        p.health > 0
      );
      
      let closestEnemyPlayer = null;
      let minPlayerDistance = Infinity;
      
      enemyPlayers.forEach(player => {
        const dist = Math.hypot(minion.x - player.position.x, minion.y - player.position.y);
        if (dist < minPlayerDistance) {
          minPlayerDistance = dist;
          closestEnemyPlayer = player;
        }
      });
      
      // Verificar se há comando de parar - se sim, não fazer nada
      if (playerCommand === 'stop' && commandAge < 10000) {
        // Tropas param completamente, não se movem e não atacam
        return; // Não fazer mais nada neste loop
      }
      
      // Verificar se há comando de defender - se sim, NÃO mover (exceto para atacar inimigos muito próximos)
      if (playerCommand === 'defend' && minion.type === 'melee' && commandAge < 10000) {
        // Minions em modo defender ficam completamente parados
        // Podem apenas atacar inimigos que estão muito próximos (dentro do alcance de ataque)
        // Mas NÃO se movem para perseguir inimigos
        const attackRange = minion.attackRange || 25;
        
        // Verificar se há inimigos muito próximos para atacar (sem se mover)
        const nearbyEnemies = state.minions.filter(m => 
          m.team !== minion.team && 
          m.health > 0 &&
          Math.hypot(minion.x - m.x, minion.y - m.y) <= attackRange
        );
        
        const nearbyEnemyPlayers = state.players.filter(p => 
          p.team !== minion.team && 
          p.health > 0 &&
          Math.hypot(minion.x - p.position.x, minion.y - p.position.y) <= attackRange
        );
        
        // Se não há inimigos próximos o suficiente para atacar, não fazer nada (ficar parado)
        if (nearbyEnemies.length === 0 && nearbyEnemyPlayers.length === 0) {
          return; // Ficar completamente parado
        }
        // Se há inimigos próximos, continuar para a lógica de ataque (mas sem movimento)
      }
      
      // Verificar se há comando de recuar - se sim, ignorar alvos e recuar
      if (playerCommand === 'retreat' && commandAge < 10000) {
        // Comando de recuar: mover em direção à torre aliada mais próxima
        const allyTowers = state.towers.filter(t => t.team === minion.team && t.health > 0);
        if (allyTowers.length > 0) {
          const closestTower = allyTowers.reduce((closest, tower) => {
            const dist = Math.hypot(minion.x - tower.x, minion.y - tower.y);
            const closestDist = Math.hypot(minion.x - closest.x, minion.y - closest.y);
            return dist < closestDist ? tower : closest;
          });
          
          const dx = closestTower.x - minion.x;
          const dy = closestTower.y - minion.y;
          const distance = Math.hypot(dx, dy);
          
          if (distance > 30) {
            let finalSpeed = minion.speed * tacticalModifier.speed;
            if (this.isOnHighGround(minion.x, minion.y, state.terrain)) {
              finalSpeed *= 1.2;
            }
            if (this.isInChokepoint(minion.x, minion.y, state.terrain)) {
              finalSpeed *= 0.7;
            }
            
            const moveX = (dx / distance) * finalSpeed;
            const moveY = (dy / distance) * finalSpeed;
            const newX = minion.x + moveX;
            const newY = minion.y + moveY;
            if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
              minion.x = newX;
              minion.y = newY;
            }
            return; // Não fazer mais nada, apenas recuar
          }
        }
      }
      
      // Verificar se há comando de focar alvo específico
      const playerTarget = minion.team === 'left' 
        ? (leftPlayer?.tacticalTarget || null)
        : (rightPlayer?.tacticalTarget || null);
      
      if (playerCommand === 'focus' && playerTarget && commandAge < 10000) {
        // Focar no alvo selecionado pelo jogador
        let targetX = null;
        let targetY = null;
        
        if (playerTarget.type === 'player') {
          const targetPlayer = state.players.find(p => p.id === playerTarget.id);
          if (targetPlayer && targetPlayer.health > 0 && targetPlayer.team !== minion.team) {
            targetX = targetPlayer.position.x;
            targetY = targetPlayer.position.y;
          }
        } else if (playerTarget.type === 'minion') {
          const targetMinion = state.minions.find(m => m.id === playerTarget.id);
          if (targetMinion && targetMinion.health > 0 && targetMinion.team !== minion.team) {
            targetX = targetMinion.x;
            targetY = targetMinion.y;
          }
        } else if (playerTarget.type === 'tower') {
          const targetTower = state.towers.find(t => t.id === playerTarget.id);
          if (targetTower && targetTower.health > 0 && targetTower.team !== minion.team) {
            targetX = targetTower.x;
            targetY = targetTower.y;
          }
        }
        
        // Se encontrou o alvo, mover em direção a ele
        if (targetX !== null && targetY !== null) {
          // Verificar se precisa atravessar o rio para chegar ao alvo
          if (this.needsToCrossRiver(minion.x, minion.y, targetX, targetY)) {
            // Encontrar a ponte mais próxima
            const nearestBridge = this.findNearestBridge(minion.x, minion.y, targetX, targetY);
            
            // Se não está na ponte ainda, ir em direção à ponte
            const riverCenterX = 500;
            const riverWidth = 80;
            const riverLeft = riverCenterX - riverWidth / 2; // 460
            const riverRight = riverCenterX + riverWidth / 2; // 540
            const currentInRiver = (minion.x >= riverLeft && minion.x <= riverRight);
            
            if (!currentInRiver || Math.abs(minion.y - nearestBridge.y) > 20) {
              // Ainda não está na ponte, ir em direção à ponte
              targetX = nearestBridge.x;
              targetY = nearestBridge.y;
            }
            // Se já está na ponte, continuar em direção ao alvo
          }
          
          const dx = targetX - minion.x;
          const dy = targetY - minion.y;
          const distance = Math.hypot(dx, dy);
          
          const isRanged = minion.type === 'ranged';
          const attackRange = isRanged ? (minion.attackRange || 120) : 25;
          
          if (distance > attackRange) {
            // Se estiver em modo defender, NÃO mover - ficar parado
            if (playerCommand === 'defend' && minion.type === 'melee') {
              // Não mover, apenas atacar se estiver no alcance
            } else {
              let finalSpeed = minion.speed * tacticalModifier.speed;
              if (this.isOnHighGround(minion.x, minion.y, state.terrain)) {
                finalSpeed *= 1.2;
              }
              if (this.isInChokepoint(minion.x, minion.y, state.terrain)) {
                finalSpeed *= 0.7;
              }
              
              const moveX = (dx / distance) * finalSpeed;
              const moveY = (dy / distance) * finalSpeed;
              const newX = minion.x + moveX;
              const newY = minion.y + moveY;
              if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
                minion.x = newX;
                minion.y = newY;
              }
            }
          } else {
            // Está no alcance, atacar
            if (now - minion.lastAttack >= minion.attackCooldown) {
              // Aplicar dano ao alvo
              let finalDamage = minion.damage * tacticalModifier.aggression;
              if (this.isOnHighGround(minion.x, minion.y, state.terrain)) {
                finalDamage *= 1.3;
              }
              
              if (playerTarget.type === 'player') {
                const targetPlayer = state.players.find(p => p.id === playerTarget.id);
                if (targetPlayer) {
                  let damageToApply = finalDamage;
                  if (this.isInCover(targetPlayer.position.x, targetPlayer.position.y, state.terrain)) {
                    damageToApply *= 0.7;
                  }
                  targetPlayer.health = Math.max(0, targetPlayer.health - damageToApply);
                }
              } else if (playerTarget.type === 'minion') {
                const targetMinion = state.minions.find(m => m.id === playerTarget.id);
                if (targetMinion) {
                  let damageToApply = finalDamage;
                  if (this.isInCover(targetMinion.x, targetMinion.y, state.terrain)) {
                    damageToApply *= 0.7;
                  }
                  targetMinion.health = Math.max(0, targetMinion.health - damageToApply);
                }
              } else if (playerTarget.type === 'tower') {
                const targetTower = state.towers.find(t => t.id === playerTarget.id);
                if (targetTower) {
                  targetTower.health = Math.max(0, targetTower.health - finalDamage);
                }
              }
              
              minion.lastAttack = now;
              minion.lastAttackAnimation = now;
            }
          }
          return; // Focar apenas neste alvo
        }
      }
      
      // Se há jogador inimigo próximo (dentro de 80px), atacar ele
      if (closestEnemyPlayer && minPlayerDistance <= 80) {
        // Verificar quantos minions aliados estão atacando o mesmo alvo
        const allyMinions = state.minions.filter(m => 
          m.team === minion.team && 
          m.id !== minion.id && 
          m.health > 0
        );
        
        // Contar quantos aliados estão próximos do alvo (dentro de 40px)
        let alliesNearTarget = 0;
        allyMinions.forEach(ally => {
          const distToTarget = Math.hypot(
            ally.x - closestEnemyPlayer.position.x,
            ally.y - closestEnemyPlayer.position.y
          );
          if (distToTarget <= 40) {
            alliesNearTarget++;
          }
        });
        
        // Se estiver em modo defender, NÃO mover - ficar parado
        if (playerCommand === 'defend' && minion.type === 'melee') {
          // Não mover, apenas atacar se estiver no alcance
        } else {
          // Mover em direção ao jogador (ranged não precisa se aproximar tanto)
          const isRanged = minion.type === 'ranged';
          const meleeRange = 25;
          const rangedRange = isRanged ? (minion.attackRange || 120) : meleeRange;
          
          if (minPlayerDistance > rangedRange) {
          let targetX = closestEnemyPlayer.position.x;
          let targetY = closestEnemyPlayer.position.y;
          
          // Verificar se precisa atravessar o rio para chegar ao alvo
          if (this.needsToCrossRiver(minion.x, minion.y, targetX, targetY)) {
            // Encontrar a ponte mais próxima
            const nearestBridge = this.findNearestBridge(minion.x, minion.y, targetX, targetY);
            
            // Se não está na ponte ainda, ir em direção à ponte
            const riverCenterX = 500;
            const riverWidth = 80;
            const riverLeft = riverCenterX - riverWidth / 2; // 460
            const riverRight = riverCenterX + riverWidth / 2; // 540
            const currentInRiver = (minion.x >= riverLeft && minion.x <= riverRight);
            
            if (!currentInRiver || Math.abs(minion.y - nearestBridge.y) > 20) {
              // Ainda não está na ponte, ir em direção à ponte
              targetX = nearestBridge.x;
              targetY = nearestBridge.y;
            }
            // Se já está na ponte, continuar em direção ao alvo
          }
          
          // Se há aliados atacando, tentar flanquear
          if (alliesNearTarget > 0) {
            // Calcular ângulo do minion em relação ao alvo
            const angleToTarget = Math.atan2(
              closestEnemyPlayer.position.y - minion.y,
              closestEnemyPlayer.position.x - minion.x
            );
            
            // Calcular posições de flanqueamento (lados do alvo)
            const flankDistance = 30; // Distância do alvo para flanquear
            const flankAngles = [
              angleToTarget + Math.PI / 2, // Lado direito
              angleToTarget - Math.PI / 2, // Lado esquerdo
              angleToTarget + Math.PI,     // Atrás
            ];
            
            // Escolher o melhor ângulo de flanqueamento (menos aliados nessa direção)
            let bestFlankAngle = angleToTarget;
            let minAlliesInDirection = Infinity;
            
            flankAngles.forEach(angle => {
              const flankX = closestEnemyPlayer.position.x + Math.cos(angle) * flankDistance;
              const flankY = closestEnemyPlayer.position.y + Math.sin(angle) * flankDistance;
              
              // Contar aliados nessa direção
              let alliesInDirection = 0;
              allyMinions.forEach(ally => {
                const distToFlank = Math.hypot(ally.x - flankX, ally.y - flankY);
                if (distToFlank < 25) {
                  alliesInDirection++;
                }
              });
              
              if (alliesInDirection < minAlliesInDirection) {
                minAlliesInDirection = alliesInDirection;
                bestFlankAngle = angle;
              }
            });
            
            // Se encontrou uma boa posição de flanqueamento, usar ela
            if (minAlliesInDirection < alliesNearTarget) {
              targetX = closestEnemyPlayer.position.x + Math.cos(bestFlankAngle) * flankDistance;
              targetY = closestEnemyPlayer.position.y + Math.sin(bestFlankAngle) * flankDistance;
            }
          }
          
          const dx = targetX - minion.x;
          const dy = targetY - minion.y;
          const distance = Math.hypot(dx, dy);
          
          // Verificar colisão com outros minions e aplicar separação
          let separationX = 0;
          let separationY = 0;
          const allMinions = state.minions.filter(m => m.id !== minion.id);
          let collisionCount = 0;
          
          allMinions.forEach(otherMinion => {
            const dist = Math.hypot(minion.x - otherMinion.x, minion.y - otherMinion.y);
            if (dist < 20 && dist > 0) {
              // Calcular força de separação
              const separationForce = (20 - dist) / 20; // Mais forte quando mais próximo
              const sepDx = (minion.x - otherMinion.x) / dist;
              const sepDy = (minion.y - otherMinion.y) / dist;
              separationX += sepDx * separationForce;
              separationY += sepDy * separationForce;
              collisionCount++;
            }
          });
          
          // Normalizar separação
          if (collisionCount > 0) {
            const sepDist = Math.hypot(separationX, separationY);
            if (sepDist > 0) {
              separationX = (separationX / sepDist) * minion.speed * 0.5;
              separationY = (separationY / sepDist) * minion.speed * 0.5;
            }
          }
          
          // Se estiver em modo defender, NÃO mover - ficar parado
          if (playerCommand === 'defend' && minion.type === 'melee') {
            // Não mover, apenas aplicar separação mínima se necessário para evitar sobreposição
            if (collisionCount > 0) {
              const newX = minion.x + separationX * 0.1; // Apenas separação mínima
              const newY = minion.y + separationY * 0.1;
              if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
                minion.x = newX;
                minion.y = newY;
              }
            }
          } else {
            // Aplicar modificadores táticos e de terreno
            let finalSpeed = minion.speed * tacticalModifier.speed;
            if (this.isOnHighGround(minion.x, minion.y, state.terrain)) {
              finalSpeed *= 1.2;
            }
            if (this.isInChokepoint(minion.x, minion.y, state.terrain)) {
              finalSpeed *= 0.7;
            }

            // Mover em direção ao alvo + separação
            if (distance > 0.1) {
              const moveX = (dx / distance) * finalSpeed + separationX;
              const moveY = (dy / distance) * finalSpeed + separationY;
              const newX = minion.x + moveX;
              const newY = minion.y + moveY;
              if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
                minion.x = newX;
                minion.y = newY;
              }
            } else if (collisionCount > 0) {
              // Se está no alvo mas há colisão, aplicar apenas separação
              const newX = minion.x + separationX;
              const newY = minion.y + separationY;
              if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
                minion.x = newX;
                minion.y = newY;
              }
            }
          }
          return; // Não mover se estiver em modo defender
        } else {
          // Atacar jogador (melee precisa estar próximo, ranged pode atacar à distância)
          const isRanged = minion.type === 'ranged';
          const attackRange = isRanged ? (minion.attackRange || 120) : 25;
          
          if (minPlayerDistance <= attackRange && now - minion.lastAttack >= minion.attackCooldown) {
            // Calcular dano com modificadores
            let finalDamage = minion.damage * tacticalModifier.aggression;
            // Moral afeta dano (moral baixa = menos dano)
            finalDamage *= (minion.moral / 100);
            // Terreno elevado aumenta dano
            if (this.isOnHighGround(minion.x, minion.y, state.terrain)) {
              finalDamage *= 1.3;
            }
            // Cobertura reduz dano recebido pelo alvo
            let damageToApply = finalDamage;
            if (this.isInCover(closestEnemyPlayer.position.x, closestEnemyPlayer.position.y, state.terrain)) {
              damageToApply *= 0.7;
            }

            const oldHealth = closestEnemyPlayer.health;
            closestEnemyPlayer.health = Math.max(0, closestEnemyPlayer.health - damageToApply);
            minion.lastAttack = now;
            minion.lastAttackAnimation = now; // Para animação

            // Habilidade especial do arqueiro (tiro especial após ficar parado)
            if (isRanged && minion.specialAttackReady) {
              damageToApply *= 2; // Dano dobrado
              closestEnemyPlayer.health = Math.max(0, closestEnemyPlayer.health - damageToApply);
              minion.specialAttackReady = false; // Usar habilidade
              minion.stationaryTime = 0; // Resetar timer
              console.log(`🏹 Arqueiro ${minion.id} usou tiro especial! Dano: ${damageToApply}`);
            }
            
            // Criar floating damage text
            if (!state.damageTexts) state.damageTexts = [];
            state.damageTexts.push({
              id: `damage_${now}_${closestEnemyPlayer.id}_minion`,
              x: closestEnemyPlayer.position.x,
              y: closestEnemyPlayer.position.y,
              value: minion.damage,
              timestamp: now,
              isSpecial: false
            });
            
            // Se for ranged, criar projétil
            if (isRanged) {
              let projectileDamage = minion.damage;
              let isSpecial = false;
              
              // Habilidade especial: tiro especial após ficar parado 3 segundos
              if (minion.specialAttackReady) {
                projectileDamage = minion.damage * 2.5; // Dano 2.5x maior
                isSpecial = true;
                minion.specialAttackReady = false;
                minion.stationaryTime = 0;
                console.log(`🏹 Arqueiro ${minion.id} usou tiro especial contra jogador! Dano: ${projectileDamage}`);
              }
              
              const projectile = {
                id: `projectile_${now}_${minion.id}`,
                x: minion.x,
                y: minion.y,
                targetX: closestEnemyPlayer.position.x,
                targetY: closestEnemyPlayer.position.y,
                team: minion.team,
                damage: projectileDamage,
                timestamp: now,
                speed: isSpecial ? 12 : 8, // Projétil especial é mais rápido
                targetId: closestEnemyPlayer.id,
                targetType: 'player',
                isSpecial: isSpecial
              };
              if (!state.projectiles) state.projectiles = [];
              state.projectiles.push(projectile);
            }
            
            console.log(`👊 Minion ${minion.id} (${minion.team}, ${isRanged ? 'ranged' : 'melee'}) atacou jogador ${closestEnemyPlayer.username}! HP: ${oldHealth} → ${closestEnemyPlayer.health}`);
            
            // Verificar se o jogador morreu
            if (closestEnemyPlayer.health <= 0) {
              console.log(`💀 Jogador ${closestEnemyPlayer.username} morreu por ataque de minion!`);
              const winner = this.checkWinner(state);
              if (winner) {
                state.winner = winner;
                // Encontrar o lobby que contém este gameState
                for (let [lobbyId, lobby] of this.lobbies.entries()) {
                  if (lobby.gameState === state) {
                    this.io.to(lobbyId).emit('game_over', { winner });
                    break;
                  }
                }
              }
            }
          }
          // Se o jogador morreu ou está muito longe, procurar outro alvo
          if (closestEnemyPlayer.health <= 0 || minPlayerDistance > 100) {
            // Jogador morreu ou está longe, continuar para procurar próximo alvo
            // Não fazer return, deixar continuar
          } else {
            // Ainda está próximo e vivo, continuar atacando
            return; // Prioridade ao jogador
          }
        }
      }
      
      // 2. Verificar se há minion inimigo próximo para lutar
      const enemyMinions = state.minions.filter(m => 
        m.team !== minion.team && 
        m.health > 0 && 
        m.id !== minion.id
      );
      
      let closestEnemyMinion = null;
      let minEnemyDistance = Infinity;
      
      enemyMinions.forEach(enemy => {
        const dist = Math.hypot(minion.x - enemy.x, minion.y - enemy.y);
        if (dist < minEnemyDistance) {
          minEnemyDistance = dist;
          closestEnemyMinion = enemy;
        }
      });
      
      // Se há minion inimigo próximo, tentar cercar e atacar (aumentado alcance de detecção)
      // IMPORTANTE: Sempre verificar minions inimigos, independente de comandos táticos
      if (closestEnemyMinion && minEnemyDistance <= 200) { // Aumentado de 60 para 200 para melhor detecção
        // Minions ranged atacam à distância, melee precisam estar próximos
        const isRanged = minion.type === 'ranged';
        const attackRange = isRanged ? (minion.attackRange || 120) : 25;
        
        // Se está no alcance de ataque
        if (minEnemyDistance <= attackRange) {
          // Inicializar lastAttack se não existir
          if (!minion.lastAttack) minion.lastAttack = 0;
          
          // Verificar cooldown de ataque
          if (now - minion.lastAttack >= minion.attackCooldown) {
            // Calcular dano com modificadores
            let finalDamage = minion.damage * tacticalModifier.aggression;
            // Moral afeta dano
            finalDamage *= (minion.moral / 100);
            // Terreno elevado aumenta dano
            if (this.isOnHighGround(minion.x, minion.y, state.terrain)) {
              finalDamage *= 1.3;
            }
            // Cobertura reduz dano recebido pelo alvo
            let damageToApply = finalDamage;
            if (this.isInCover(closestEnemyMinion.x, closestEnemyMinion.y, state.terrain)) {
              damageToApply *= 0.7;
            }

            const oldHealth = closestEnemyMinion.health;
            const damageResult = this.applyDamageToMinion(closestEnemyMinion, damageToApply);
            minion.lastAttack = now;
            minion.lastAttackAnimation = now; // Para animação
            
            // Criar floating damage text
            if (!state.damageTexts) state.damageTexts = [];
            state.damageTexts.push({
              id: `damage_${now}_${closestEnemyMinion.id}_minion`,
              x: closestEnemyMinion.x,
              y: closestEnemyMinion.y,
              value: minion.damage,
              timestamp: now,
              isSpecial: false
            });
            
            // Se for ranged, criar projétil
            if (isRanged) {
              let projectileDamage = minion.damage;
              let isSpecial = false;
              
              // Habilidade especial: tiro especial após ficar parado 3 segundos
              if (minion.specialAttackReady) {
                projectileDamage = minion.damage * 2.5; // Dano 2.5x maior
                isSpecial = true;
                minion.specialAttackReady = false;
                minion.stationaryTime = 0;
                console.log(`🏹 Arqueiro ${minion.id} usou tiro especial contra minion! Dano: ${projectileDamage}`);
              }
              
              const projectile = {
                id: `projectile_${now}_${minion.id}`,
                x: minion.x,
                y: minion.y,
                targetX: closestEnemyMinion.x,
                targetY: closestEnemyMinion.y,
                team: minion.team,
                damage: projectileDamage,
                timestamp: now,
                speed: isSpecial ? 12 : 8, // Projétil especial é mais rápido
                targetId: closestEnemyMinion.id,
                isSpecial: isSpecial
              };
              if (!state.projectiles) state.projectiles = [];
              state.projectiles.push(projectile);
            }
            
            // Rastrear quem causou o dano (para dar moeda quando morrer)
            closestEnemyMinion.lastDamagedBy = {
              type: 'minion',
              minionId: minion.id,
              team: minion.team
            };
            
            // Se o minion inimigo morreu, dar moeda ao jogador do time que matou
            if (closestEnemyMinion.health <= 0 && oldHealth > 0) {
              const killerTeam = minion.team;
              const killerPlayer = state.players.find(p => p.team === killerTeam);
              if (killerPlayer) {
                killerPlayer.coins = (killerPlayer.coins || 0) + 1;
                console.log(`💰 Jogador ${killerPlayer.username} ganhou 1 moeda por minion matar outro minion! Total: ${killerPlayer.coins}`);
              }
            }
            
            console.log(`👊 Minion ${minion.id} (${minion.team}, ${isRanged ? 'ranged' : 'melee'}) atacou ${closestEnemyMinion.id} (${closestEnemyMinion.team})! HP: ${oldHealth} → ${closestEnemyMinion.health}`);
          }
          // Se o alvo morreu ou está muito longe, procurar próximo alvo
          if (closestEnemyMinion.health <= 0 || minEnemyDistance > 200) { // Aumentado de 60 para 200
            // Alvo morreu ou está longe, continuar para procurar próximo alvo
            // Não fazer return, deixar continuar para procurar torre ou outro alvo
          } else {
            // Ainda está próximo e vivo, continuar atacando
            return; // Ainda está lutando com este alvo
          }
        } else {
          // Se estiver em modo defender, NÃO mover - ficar parado
          if (playerCommand === 'defend' && minion.type === 'melee') {
            return; // Ficar parado, não perseguir inimigos
          }
          
          // Ainda não está perto o suficiente, mover em direção ao minion inimigo
          // Verificar aliados próximos para flanquear
          const allyMinions = state.minions.filter(m => 
            m.team === minion.team && 
            m.id !== minion.id && 
            m.health > 0
          );
          
          let alliesNearTarget = 0;
          allyMinions.forEach(ally => {
            const distToTarget = Math.hypot(
              ally.x - closestEnemyMinion.x,
              ally.y - closestEnemyMinion.y
            );
            if (distToTarget <= 40) {
              alliesNearTarget++;
            }
          });
          
          let targetX = closestEnemyMinion.x;
          let targetY = closestEnemyMinion.y;
          
          // Verificar se precisa atravessar o rio para chegar ao alvo
          if (this.needsToCrossRiver(minion.x, minion.y, targetX, targetY)) {
            // Encontrar a ponte mais próxima
            const nearestBridge = this.findNearestBridge(minion.x, minion.y, targetX, targetY);
            
            // Se não está na ponte ainda, ir em direção à ponte
            const riverCenterX = 500;
            const riverWidth = 80;
            const riverLeft = riverCenterX - riverWidth / 2; // 460
            const riverRight = riverCenterX + riverWidth / 2; // 540
            const currentInRiver = (minion.x >= riverLeft && minion.x <= riverRight);
            
            if (!currentInRiver || Math.abs(minion.y - nearestBridge.y) > 20) {
              // Ainda não está na ponte, ir em direção à ponte
              targetX = nearestBridge.x;
              targetY = nearestBridge.y;
            }
            // Se já está na ponte, continuar em direção ao alvo
          }
          
          // Se há aliados, tentar flanquear
          if (alliesNearTarget > 0) {
            const angleToTarget = Math.atan2(
              closestEnemyMinion.y - minion.y,
              closestEnemyMinion.x - minion.x
            );
            
            const flankDistance = 30;
            const flankAngles = [
              angleToTarget + Math.PI / 2,
              angleToTarget - Math.PI / 2,
              angleToTarget + Math.PI,
            ];
            
            let bestFlankAngle = angleToTarget;
            let minAlliesInDirection = Infinity;
            
            flankAngles.forEach(angle => {
              const flankX = closestEnemyMinion.x + Math.cos(angle) * flankDistance;
              const flankY = closestEnemyMinion.y + Math.sin(angle) * flankDistance;
              
              let alliesInDirection = 0;
              allyMinions.forEach(ally => {
                const distToFlank = Math.hypot(ally.x - flankX, ally.y - flankY);
                if (distToFlank < 25) {
                  alliesInDirection++;
                }
              });
              
              if (alliesInDirection < minAlliesInDirection) {
                minAlliesInDirection = alliesInDirection;
                bestFlankAngle = angle;
              }
            });
            
            if (minAlliesInDirection < alliesNearTarget) {
              targetX = closestEnemyMinion.x + Math.cos(bestFlankAngle) * flankDistance;
              targetY = closestEnemyMinion.y + Math.sin(bestFlankAngle) * flankDistance;
            }
          }
          
          const dx = targetX - minion.x;
          const dy = targetY - minion.y;
          const distance = Math.hypot(dx, dy);
          
          // Verificar colisão e aplicar separação
          let separationX = 0;
          let separationY = 0;
          const allMinions = state.minions.filter(m => m.id !== minion.id);
          let collisionCount = 0;
          
          allMinions.forEach(otherMinion => {
            const dist = Math.hypot(minion.x - otherMinion.x, minion.y - otherMinion.y);
            if (dist < 20 && dist > 0) {
              const separationForce = (20 - dist) / 20;
              const sepDx = (minion.x - otherMinion.x) / dist;
              const sepDy = (minion.y - otherMinion.y) / dist;
              separationX += sepDx * separationForce;
              separationY += sepDy * separationForce;
              collisionCount++;
            }
          });
          
          if (collisionCount > 0) {
            const sepDist = Math.hypot(separationX, separationY);
            if (sepDist > 0) {
              separationX = (separationX / sepDist) * minion.speed * 0.5;
              separationY = (separationY / sepDist) * minion.speed * 0.5;
            }
          }
          
          // Se estiver em modo defender, NÃO mover - ficar parado
          if (playerCommand === 'defend' && minion.type === 'melee') {
            // Não mover, apenas aplicar separação mínima se necessário
            if (collisionCount > 0) {
              const newX = minion.x + separationX * 0.1;
              const newY = minion.y + separationY * 0.1;
              if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
                minion.x = newX;
                minion.y = newY;
              }
            }
          } else {
            // Aplicar modificadores táticos e de terreno
            let finalSpeed2 = minion.speed * tacticalModifier.speed;
            if (this.isOnHighGround(minion.x, minion.y, state.terrain)) {
              finalSpeed2 *= 1.2;
            }
            if (this.isInChokepoint(minion.x, minion.y, state.terrain)) {
              finalSpeed2 *= 0.7;
            }

            // Mover em direção ao alvo + separação
            if (distance > 0.1) {
              const moveX = (dx / distance) * finalSpeed2 + separationX;
              const moveY = (dy / distance) * finalSpeed2 + separationY;
              const newX = minion.x + moveX;
              const newY = minion.y + moveY;
              if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
                minion.x = newX;
                minion.y = newY;
              }
            } else if (collisionCount > 0) {
              const newX = minion.x + separationX;
              const newY = minion.y + separationY;
              if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
                minion.x = newX;
                minion.y = newY;
              }
            }
          }
        }
          return; // Focar no minion inimigo
        }
      }
      
      // 3. Se não há alvos próximos, procurar torre
      const enemyTowers = state.towers.filter(t => t.team !== minion.team && t.health > 0);
      
      if (enemyTowers.length === 0) {
        return;
      }

      // Encontrar torre mais próxima
      let closestTower = enemyTowers[0];
      let minDistance = Math.hypot(
        minion.x - closestTower.x,
        minion.y - closestTower.y
      );

      enemyTowers.forEach(tower => {
        const dist = Math.hypot(minion.x - tower.x, minion.y - tower.y);
        if (dist < minDistance) {
          minDistance = dist;
          closestTower = tower;
        }
      });

      // Verificar colisão com outros minions e aplicar separação
      let separationX = 0;
      let separationY = 0;
      const allMinions = state.minions.filter(m => m.id !== minion.id);
      let collisionCount = 0;
      
      allMinions.forEach(otherMinion => {
        const dist = Math.hypot(minion.x - otherMinion.x, minion.y - otherMinion.y);
        if (dist < 20 && dist > 0) {
          const separationForce = (20 - dist) / 20;
          const sepDx = (minion.x - otherMinion.x) / dist;
          const sepDy = (minion.y - otherMinion.y) / dist;
          separationX += sepDx * separationForce;
          separationY += sepDy * separationForce;
          collisionCount++;
        }
      });
      
      if (collisionCount > 0) {
        const sepDist = Math.hypot(separationX, separationY);
        if (sepDist > 0) {
          separationX = (separationX / sepDist) * minion.speed * 0.5;
          separationY = (separationY / sepDist) * minion.speed * 0.5;
        }
      }

      // Se estiver em modo defender, NÃO mover em direção à torre - ficar parado
      if (playerCommand === 'defend' && minion.type === 'melee') {
        // Não mover, ficar parado onde está
      } else if (minDistance > 30) {
        // Mover em direção à torre (com separação de colisão)
        // Verificar aliados próximos da torre para flanquear
        const allyMinions = state.minions.filter(m => 
          m.team === minion.team && 
          m.id !== minion.id && 
          m.health > 0
        );
        
        let alliesNearTower = 0;
        allyMinions.forEach(ally => {
          const distToTower = Math.hypot(ally.x - closestTower.x, ally.y - closestTower.y);
          if (distToTower <= 50) {
            alliesNearTower++;
          }
        });
        
        let targetX = closestTower.x;
        let targetY = closestTower.y;
        
        // Verificar se precisa atravessar o rio para chegar ao alvo
        if (this.needsToCrossRiver(minion.x, minion.y, targetX, targetY)) {
          // Encontrar a ponte mais próxima
          const nearestBridge = this.findNearestBridge(minion.x, minion.y, targetX, targetY);
          
          // Se não está na ponte ainda, ir em direção à ponte
          const riverCenterX = 500;
          const riverWidth = 80;
          const riverLeft = riverCenterX - riverWidth / 2; // 460
          const riverRight = riverCenterX + riverWidth / 2; // 540
          const currentInRiver = (minion.x >= riverLeft && minion.x <= riverRight);
          
          if (!currentInRiver || Math.abs(minion.y - nearestBridge.y) > 20) {
            // Ainda não está na ponte, ir em direção à ponte
            targetX = nearestBridge.x;
            targetY = nearestBridge.y;
          }
          // Se já está na ponte, continuar em direção ao alvo
        }
        
        // Se há aliados atacando a torre, tentar flanquear
        if (alliesNearTower > 0) {
          const angleToTower = Math.atan2(
            closestTower.y - minion.y,
            closestTower.x - minion.x
          );
          
          const flankDistance = 35;
          const flankAngles = [
            angleToTower + Math.PI / 2,
            angleToTower - Math.PI / 2,
            angleToTower + Math.PI,
          ];
          
          let bestFlankAngle = angleToTower;
          let minAlliesInDirection = Infinity;
          
          flankAngles.forEach(angle => {
            const flankX = closestTower.x + Math.cos(angle) * flankDistance;
            const flankY = closestTower.y + Math.sin(angle) * flankDistance;
            
            let alliesInDirection = 0;
            allyMinions.forEach(ally => {
              const distToFlank = Math.hypot(ally.x - flankX, ally.y - flankY);
              if (distToFlank < 30) {
                alliesInDirection++;
              }
            });
            
            if (alliesInDirection < minAlliesInDirection) {
              minAlliesInDirection = alliesInDirection;
              bestFlankAngle = angle;
            }
          });
          
          if (minAlliesInDirection < alliesNearTower) {
            targetX = closestTower.x + Math.cos(bestFlankAngle) * flankDistance;
            targetY = closestTower.y + Math.sin(bestFlankAngle) * flankDistance;
          }
        }
        
        const dx = targetX - minion.x;
        const dy = targetY - minion.y;
        const distance = Math.hypot(dx, dy);
        
        // Aplicar separação se houver colisão
        let finalSepX = separationX;
        let finalSepY = separationY;
        if (collisionCount > 0) {
          const sepDist = Math.hypot(separationX, separationY);
          if (sepDist > 0) {
            finalSepX = (separationX / sepDist) * minion.speed * 0.5;
            finalSepY = (separationY / sepDist) * minion.speed * 0.5;
          }
        }
        
        // Aplicar modificadores táticos e de terreno
        let finalSpeed3 = minion.speed * tacticalModifier.speed;
        if (this.isOnHighGround(minion.x, minion.y, state.terrain)) {
          finalSpeed3 *= 1.2;
        }
        if (this.isInChokepoint(minion.x, minion.y, state.terrain)) {
          finalSpeed3 *= 0.7;
        }

        if (distance > 0.1) {
          const moveX = (dx / distance) * finalSpeed3 + finalSepX;
          const moveY = (dy / distance) * finalSpeed3 + finalSepY;
          const newX = minion.x + moveX;
          const newY = minion.y + moveY;
          if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
            minion.x = newX;
            minion.y = newY;
          }
        } else if (collisionCount > 0) {
          // Aplicar apenas separação se estiver no alvo mas colidindo
          const newX = minion.x + finalSepX;
          const newY = minion.y + finalSepY;
          if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
            minion.x = newX;
            minion.y = newY;
          }
        }
      } else if (minDistance <= 30) {
        // Atacar torre
        if (now - minion.lastAttack >= minion.attackCooldown) {
          // Calcular dano com modificadores
          let finalDamage = minion.damage * tacticalModifier.aggression;
          // Moral afeta dano
          finalDamage *= (minion.moral / 100);
          // Terreno elevado aumenta dano
          if (this.isOnHighGround(minion.x, minion.y, state.terrain)) {
            finalDamage *= 1.3;
          }

          const oldHealth = closestTower.health;
          closestTower.health = Math.max(0, closestTower.health - finalDamage);
          minion.lastAttack = now;
          minion.lastAttackAnimation = now; // Para animação
          if (oldHealth !== closestTower.health) {
            console.log(`⚔️ Minion ${minion.id} atacou torre ${closestTower.id}! HP: ${oldHealth} → ${closestTower.health} (dano: ${finalDamage.toFixed(1)})`);
          }
        }
        
        // Aplicar separação mesmo quando atacando (para não ficar empilhado)
        if (collisionCount > 0) {
          const sepDist = Math.hypot(separationX, separationY);
          if (sepDist > 0) {
            const finalSepX = (separationX / sepDist) * minion.speed * 0.3;
            const finalSepY = (separationY / sepDist) * minion.speed * 0.3;
            const newX = minion.x + finalSepX;
            const newY = minion.y + finalSepY;
            if (this.canCrossRiver(minion.x, minion.y, newX, newY) && !this.checkTowerCollision(newX, newY, state)) {
              minion.x = newX;
              minion.y = newY;
            }
          }
        }
        
        // Continuar procurando outros alvos se a torre for destruída
        if (closestTower.health <= 0) {
          // Torre destruída, continuar para procurar próximo alvo
        }
      }
    });

    // Remover minions mortos (moedas já foram dadas automaticamente quando morreram)
    const before = state.minions.length;
    state.minions = state.minions.filter(m => m.health > 0);
    if (before !== state.minions.length) {
      console.log(`💀 ${before - state.minions.length} minions mortos removidos`);
    }
  }

  spawnCoins(lobby) {
    const state = lobby.gameState;
    if (!state) return;

    // Spawnar moedas no campo de cada time (lado inimigo)
    const now = Date.now();
    const coinLifetime = 10000; // Moedas expiram após 10 segundos
    
    // Moeda no campo LEFT (para jogadores RIGHT coletarem)
    const leftCoin = {
      id: `coin_${now}_left`,
      x: 150 + Math.random() * 200, // Entre 150 e 350 (lado esquerdo)
      y: 100 + Math.random() * 400, // Entre 100 e 500
      team: 'left', // Campo onde spawna
      collected: false,
      spawnTime: now, // Timestamp de quando foi criada
      lifetime: coinLifetime // Tempo de vida em ms
    };
    state.coins.push(leftCoin);

    // Moeda no campo RIGHT (para jogadores LEFT coletarem)
    const rightCoin = {
      id: `coin_${now}_right`,
      x: 450 + Math.random() * 200, // Entre 450 e 650 (lado direito)
      y: 100 + Math.random() * 400, // Entre 100 e 500
      team: 'right', // Campo onde spawna
      collected: false,
      spawnTime: now, // Timestamp de quando foi criada
      lifetime: coinLifetime // Tempo de vida em ms
    };
    state.coins.push(rightCoin);

    console.log(`💰 Moedas spawnadas: LEFT em (${leftCoin.x.toFixed(0)}, ${leftCoin.y.toFixed(0)}), RIGHT em (${rightCoin.x.toFixed(0)}, ${rightCoin.y.toFixed(0)})`);
  }

  checkCoinCollection(lobby) {
    const state = lobby.gameState;
    if (!state) return;

    state.players.forEach(player => {
      state.coins.forEach(coin => {
        if (coin.collected) return;

        // Jogador só pode coletar moedas do campo inimigo
        if (coin.team === player.team) return;

        const dist = Math.hypot(
          player.position.x - coin.x,
          player.position.y - coin.y
        );

        if (dist < 25) { // Raio de coleta
          coin.collected = true;
          player.coins += 1;
          console.log(`💰 Jogador ${player.username} coletou moeda! Total: ${player.coins}`);
        }
      });
    });

    // Remover moedas coletadas
    const before = state.coins.length;
    state.coins = state.coins.filter(coin => !coin.collected);
    if (before !== state.coins.length) {
      console.log(`🧹 Removidas ${before - state.coins.length} moedas coletadas`);
    }
  }

  checkWinner(state) {
    // Verificar se algum jogador morreu (vida <= 0)
    if (state.players) {
      const leftPlayer = state.players.find(p => p.team === 'left');
      const rightPlayer = state.players.find(p => p.team === 'right');
      
      if (leftPlayer && leftPlayer.health <= 0) {
        console.log(`💀 Jogador ${leftPlayer.username} morreu! Vitória do time RIGHT no round`);
        return 'right';
      }
      if (rightPlayer && rightPlayer.health <= 0) {
        console.log(`💀 Jogador ${rightPlayer.username} morreu! Vitória do time LEFT no round`);
        return 'left';
      }
    }
    
    // Verificar se todas as torres de um time foram destruídas
    const leftTowersAlive = state.towers.filter(t => t.team === 'left' && t.health > 0).length;
    const rightTowersAlive = state.towers.filter(t => t.team === 'right' && t.health > 0).length;

    if (leftTowersAlive === 0) return 'right';
    if (rightTowersAlive === 0) return 'left';
    return null;
  }

  handleRoundEnd(lobby, roundWinner) {
    console.log(`\n🏆 ROUND ${lobby.currentRound} FINALIZADO! Vencedor: ${roundWinner.toUpperCase()}`);
    
    const state = lobby.gameState;
    if (!state) return;

    // Atualizar contagem de vitórias
    lobby.roundWins[roundWinner]++;
    state.roundWins[roundWinner]++;

    // Distribuir moedas
    state.players.forEach(player => {
      if (player.team === roundWinner) {
        player.coins += 100; // Vencedor ganha 100 moedas
        console.log(`💰 ${player.username} (vencedor) ganhou 100 moedas. Total: ${player.coins}`);
      } else {
        player.coins += 50; // Perdedor ganha 50 moedas
        console.log(`💰 ${player.username} (perdedor) ganhou 50 moedas. Total: ${player.coins}`);
      }
    });

    // Verificar se alguém ganhou 2 rounds (vitória automática)
    if (lobby.roundWins.left >= 2) {
      // Time LEFT ganhou a partida
      state.winner = 'left';
      state.status = 'game_end';
      
      console.log(`\n🎉 JOGO FINALIZADO! Vencedor final: LEFT`);
      console.log(`   Placar: LEFT ${lobby.roundWins.left} x ${lobby.roundWins.right} RIGHT`);
      
      this.io.to(lobby.id).emit('game_over', { 
        winner: 'left',
        roundWins: lobby.roundWins,
        finalScore: { left: lobby.roundWins.left, right: lobby.roundWins.right }
      });
      return;
    }
    
    if (lobby.roundWins.right >= 2) {
      // Time RIGHT ganhou a partida
      state.winner = 'right';
      state.status = 'game_end';
      
      console.log(`\n🎉 JOGO FINALIZADO! Vencedor final: RIGHT`);
      console.log(`   Placar: LEFT ${lobby.roundWins.left} x ${lobby.roundWins.right} RIGHT`);
      
      this.io.to(lobby.id).emit('game_over', { 
        winner: 'right',
        roundWins: lobby.roundWins,
        finalScore: { left: lobby.roundWins.left, right: lobby.roundWins.right }
      });
      return;
    }
    
    // Verificar se é o último round possível (3 rounds)
    if (lobby.currentRound >= lobby.maxRounds) {
      // Jogo finalizado - decidir por quem tem mais vitórias
      const finalWinner = lobby.roundWins.left > lobby.roundWins.right ? 'left' : 'right';
      state.winner = finalWinner;
      state.status = 'game_end';
      
      console.log(`\n🎉 JOGO FINALIZADO! Vencedor final: ${finalWinner.toUpperCase()}`);
      console.log(`   Placar: LEFT ${lobby.roundWins.left} x ${lobby.roundWins.right} RIGHT`);
      
      this.io.to(lobby.id).emit('game_over', { 
        winner: finalWinner,
        roundWins: lobby.roundWins,
        finalScore: { left: lobby.roundWins.left, right: lobby.roundWins.right }
      });
      return;
    }

    // Preparar próximo round
    lobby.currentRound++;
    state.currentRound = lobby.currentRound;
    state.status = 'preparing';
    state.roundWinner = null;
    lobby.status = 'preparing';
    lobby.readyPlayers = new Set();

    // Salvar tropas não posicionadas e resetar posicionamento
    state.players.forEach(player => {
      // Manter apenas tropas não posicionadas
      const unplacedTroops = player.troops.filter(troop => !troop.placed);
      player.troops = unplacedTroops.map(troop => ({
        ...troop,
        placed: false, // Garantir que está marcado como não posicionado
        x: 0, // Resetar posição
        y: 0
      }));
      
      // Resetar status de prontidão
      player.ready = false;
      
      // Resetar posição e vida do jogador
      const index = lobby.players.findIndex(p => p.userId === player.id);
      player.position = {
        x: index === 0 ? 100 : 700,
        y: 300
      };
      player.health = 100;
    });

    // Resetar torres
    state.towers = [
      { id: 'tower_left_1', x: 50, y: 175, health: 100, maxHealth: 100, team: 'left', upgradeLevel: 0, lastAttack: 0, firstAttackDelay: Date.now() + 3000 },
      { id: 'tower_left_2', x: 50, y: 525, health: 100, maxHealth: 100, team: 'left', upgradeLevel: 0, lastAttack: 0, firstAttackDelay: Date.now() + 3000 },
      { id: 'tower_right_1', x: 950, y: 175, health: 100, maxHealth: 100, team: 'right', upgradeLevel: 0, lastAttack: 0, firstAttackDelay: Date.now() + 3000 },
      { id: 'tower_right_2', x: 950, y: 525, health: 100, maxHealth: 100, team: 'right', upgradeLevel: 0, lastAttack: 0, firstAttackDelay: Date.now() + 3000 }
    ];

    // Limpar minions, ataques, projéteis e moedas do campo
    state.minions = [];
    state.attacks = [];
    state.projectiles = [];
    state.coins = [];

    console.log(`\n🔄 Preparando Round ${lobby.currentRound}...`);
    console.log(`   Placar atual: LEFT ${lobby.roundWins.left} x ${lobby.roundWins.right} RIGHT`);

    // Notificar jogadores sobre o fim do round e início da preparação
    const cleanState = this.sanitizeGameState(state);
    this.io.to(lobby.id).emit('round_end', {
      roundWinner,
      roundNumber: lobby.currentRound - 1,
      roundWins: { ...lobby.roundWins },
      nextRound: lobby.currentRound,
      gameState: cleanState
    });

    // Iniciar fase de preparação
    setTimeout(() => {
      this.io.to(lobby.id).emit('game_preparation_started', {
        gameId: lobby.gameId,
        gameState: cleanState
      });
    }, 3000); // 3 segundos de delay para mostrar resultado do round
  }

  // Limpar referências circulares antes de enviar via socket.io
  sanitizeGameState(state) {
    const clean = JSON.parse(JSON.stringify(state));
    
    // Limpar referências circulares dos minions
    if (clean.minions) {
      clean.minions.forEach(minion => {
        delete minion.targetMinion;
        delete minion.targetTower;
      });
    }
    
    return clean;
  }
}

const gameServer = new GameServer();
module.exports = gameServer;

