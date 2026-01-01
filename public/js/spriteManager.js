// Gerenciador de Sprites
class SpriteManager {
    constructor() {
        this.sprites = new Map();
        this.loaded = false;
        this.animationStates = new Map(); // Armazenar estado de animação por minion
    }

    // Carregar sprite sheet (com suporte a sprite sheets horizontais)
    async loadSpriteSheet(name, imagePath, frameWidth, frameHeight, maxFrames = null) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const frames = [];
                
                // Calcular quantas colunas tem o sprite sheet automaticamente
                const cols = Math.floor(img.width / frameWidth);
                const actualFrameCount = maxFrames ? Math.min(maxFrames, cols) : cols;
                
                // Extrair frames do sprite sheet (horizontal)
                for (let i = 0; i < actualFrameCount; i++) {
                    frames.push({
                        x: i * frameWidth,
                        y: 0,
                        width: frameWidth,
                        height: frameHeight
                    });
                }
                
                this.sprites.set(name, {
                    image: img,
                    frames: frames,
                    frameWidth: frameWidth,
                    frameHeight: frameHeight,
                    frameCount: frames.length
                });
                
                console.log(`✅ Sprite carregado: ${name} (${frames.length} frames de ${cols} disponíveis)`);
                resolve();
            };
            
            img.onerror = () => {
                console.warn(`⚠️ Sprite não encontrado: ${imagePath} - Usando fallback`);
                // Não rejeitar, apenas usar fallback
                resolve();
            };
            
            img.src = imagePath;
        });
    }

    // Inicializar animação para um minion
    initAnimation(minionId, animationType) {
        if (!this.animationStates.has(minionId)) {
            this.animationStates.set(minionId, {
                currentAnimation: animationType,
                frameIndex: 0,
                lastFrameTime: Date.now(),
                direction: 1 // 1 = direita, -1 = esquerda
            });
        }
    }

    // Atualizar animação (melhorado para animações mais suaves)
    updateAnimation(minionId, animationType, direction, fps = 10) {
        const state = this.animationStates.get(minionId);
        if (!state) {
            this.initAnimation(minionId, animationType);
            return;
        }

        const now = Date.now();
        const frameDelay = 1000 / fps; // ms por frame

        // Mudar animação se necessário
        if (state.currentAnimation !== animationType) {
            state.currentAnimation = animationType;
            state.frameIndex = 0;
            state.lastFrameTime = now;
        }

        // Atualizar direção
        if (direction !== undefined) {
            state.direction = direction > 0 ? 1 : -1;
        }

        // Avançar frame (melhorado para animações mais suaves e completas)
        const sprite = this.sprites.get(animationType);
        if (sprite && sprite.frames.length > 0) {
            // Verificar se passou tempo suficiente para próximo frame
            // Usar acumulação de tempo para evitar perda de frames e tornar animação mais fluida
            let elapsed = now - state.lastFrameTime;
            while (elapsed >= frameDelay && sprite.frames.length > 0) {
                state.frameIndex = (state.frameIndex + 1) % sprite.frames.length;
                elapsed -= frameDelay;
                state.lastFrameTime = now - elapsed;
            }
        } else {
            // Se sprite não existe, resetar frame
            state.frameIndex = 0;
        }
    }

    // Desenhar sprite animado
    drawAnimatedSprite(ctx, minionId, animationType, x, y, width, height, direction = 1) {
        // Determinar FPS baseado no tipo de animação (mais realista e suave)
        let fps = 6; // FPS padrão mais lento e realista
        if (animationType.includes('attack')) {
            fps = 8; // Ataque um pouco mais rápido
        } else if (animationType.includes('run')) {
            fps = 9; // Corrida suave e igual ao personagem principal (reduzido de 12 para 9)
        } else {
            fps = 5; // Idle mais lento
        }
        
        // Atualizar animação com FPS ajustado
        this.updateAnimation(minionId, animationType, direction, fps);

        const state = this.animationStates.get(minionId);
        if (!state) {
            this.initAnimation(minionId, animationType);
            return this.drawAnimatedSprite(ctx, minionId, animationType, x, y, width, height, direction);
        }

        const sprite = this.sprites.get(animationType);
        if (!sprite || !sprite.frames[state.frameIndex]) {
            // Fallback: desenhar círculo se sprite não carregado
            ctx.fillStyle = '#3498db';
            ctx.beginPath();
            ctx.arc(x, y, width / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        const frame = sprite.frames[state.frameIndex];
        const flip = state.direction < 0;
        
        ctx.save();
        
        if (flip) {
            ctx.scale(-1, 1);
            ctx.translate(-x * 2, 0);
        }
        
        ctx.drawImage(
            sprite.image,
            frame.x, frame.y, frame.width, frame.height,
            x - width / 2, y - height / 2, width, height
        );
        
        ctx.restore();
    }

    // Desenhar frame específico (método antigo mantido para compatibilidade)
    drawFrame(ctx, spriteName, frameIndex, x, y, width, height, flip = false) {
        const sprite = this.sprites.get(spriteName);
        if (!sprite || !sprite.frames[frameIndex]) {
            // Fallback: desenhar círculo se sprite não carregado
            ctx.fillStyle = '#3498db';
            ctx.beginPath();
            ctx.arc(x, y, width / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        const frame = sprite.frames[frameIndex];
        
        ctx.save();
        
        if (flip) {
            ctx.scale(-1, 1);
            ctx.translate(-x * 2 - width, 0);
        }
        
        ctx.drawImage(
            sprite.image,
            frame.x, frame.y, frame.width, frame.height,
            x - width / 2, y - height / 2, width, height
        );
        
        ctx.restore();
    }

    // Obter número de frames
    getFrameCount(spriteName) {
        const sprite = this.sprites.get(spriteName);
        return sprite ? sprite.frames.length : 0;
    }

    // Limpar animação de um minion (quando morre)
    clearAnimation(minionId) {
        this.animationStates.delete(minionId);
    }
}

// Instância global
const spriteManager = new SpriteManager();

// Carregar sprites das tropas ao inicializar
async function loadTroopSprites() {
    try {
        // Sprites para tropas melee (guerreiros)
        // Usar caminho servido pelo Express (/sprites)
        await spriteManager.loadSpriteSheet(
            'melee_idle',
            '/sprites/FreeKnight_v1/Colour1/NoOutline/120x80_PNGSheets/_Idle.png',
            120, 80, 10 // Assumindo ~10 frames por animação
        );
        
        await spriteManager.loadSpriteSheet(
            'melee_run',
            '/sprites/FreeKnight_v1/Colour1/NoOutline/120x80_PNGSheets/_Run.png',
            120, 80, 10
        );
        
        await spriteManager.loadSpriteSheet(
            'melee_attack',
            '/sprites/FreeKnight_v1/Colour1/NoOutline/120x80_PNGSheets/_Attack.png',
            120, 80, 8
        );
        
        // Sprites para tropas ranged (arqueiros) - usar Colour2 para diferenciar
        await spriteManager.loadSpriteSheet(
            'ranged_idle',
            '/sprites/FreeKnight_v1/Colour2/NoOutline/120x80_PNGSheets/_Idle.png',
            120, 80, 10
        );
        
        await spriteManager.loadSpriteSheet(
            'ranged_run',
            '/sprites/FreeKnight_v1/Colour2/NoOutline/120x80_PNGSheets/_Run.png',
            120, 80, 10
        );
        
        await spriteManager.loadSpriteSheet(
            'ranged_attack',
            '/sprites/FreeKnight_v1/Colour2/NoOutline/120x80_PNGSheets/_Attack.png',
            120, 80, 8
        );
        
        // Sprites de morte para melee e ranged
        await spriteManager.loadSpriteSheet(
            'melee_death',
            '/sprites/FreeKnight_v1/Colour1/NoOutline/120x80_PNGSheets/_Death.png',
            120, 80, 10
        );
        
        await spriteManager.loadSpriteSheet(
            'ranged_death',
            '/sprites/FreeKnight_v1/Colour2/NoOutline/120x80_PNGSheets/_Death.png',
            120, 80, 10
        );
        
        // Sprite de morte para o player (usar Colour1)
        await spriteManager.loadSpriteSheet(
            'player_death',
            '/sprites/FreeKnight_v1/Colour1/NoOutline/120x80_PNGSheets/_Death.png',
            120, 80, 10
        );
        
        spriteManager.loaded = true;
        console.log('✅ Todos os sprites de tropas carregados!');
    } catch (error) {
        console.warn('⚠️ Erro ao carregar sprites:', error);
        spriteManager.loaded = false;
    }
}

// Carregar sprites quando o script for executado
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadTroopSprites);
} else {
    loadTroopSprites();
}

