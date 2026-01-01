# ⚔️ War Royale

Jogo multiplayer inspirado em Clash Royale com controle direto de campeão (estilo League of Legends).

## 🎮 Características

- Sistema de autenticação (registro/login)
- Sistema de lobby para matchmaking
- Controle direto do campeão com WASD/Setas
- Ataques manuais
- 2 torres por lado
- Mapa 2D no estilo Clash Royale
- Multiplayer em tempo real com Socket.io

## 🚀 Como executar

1. Instale as dependências:
```bash
npm install
```

2. Inicie o servidor:
```bash
npm start
```

Ou em modo desenvolvimento (com auto-reload):
```bash
npm run dev
```

3. Acesse no navegador:
```
http://localhost:3000
```

## 🌐 Como Jogar com Amigos (SEM Hospedagem!)

**Você NÃO precisa hospedar!** Use um túnel grátis:

### Opção 1: ngrok (Mais Fácil)
```bash
# Terminal 1
npm start

# Terminal 2
ngrok http 3000
```
Compartilhe a URL gerada (ex: `https://abc123.ngrok.io`)

### Opção 2: localhost.run (Mac/Linux)
```bash
# Terminal 1
npm start

# Terminal 2
ssh -R 80:localhost:3000 nokey@localhost.run
```

📖 **Guia completo:** Veja [SEM_HOSPEDAGEM.md](./SEM_HOSPEDAGEM.md) para instruções detalhadas!

## 📋 Funcionalidades Implementadas

- ✅ Sistema de autenticação (JWT)
- ✅ Criação e entrada em lobbies
- ✅ Sistema de matchmaking básico
- ✅ Controles de movimento (WASD/Setas)
- ✅ Renderização básica do jogo
- ✅ Sincronização de movimento em tempo real

## 🎯 Próximos Passos

- [ ] Sistema de ataque completo
- [ ] Sistema de dano e vida
- [ ] Destruição de torres
- [ ] Sistema de habilidades
- [ ] Minions/creeps
- [ ] Sistema de vitória/derrota
- [ ] Melhorias visuais

## 🛠️ Tecnologias

- Node.js + Express
- Socket.io (multiplayer)
- HTML5 Canvas
- JWT (autenticação)
- bcryptjs (hash de senhas)

# WarRoyale
