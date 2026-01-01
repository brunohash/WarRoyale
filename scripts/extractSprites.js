#!/usr/bin/env node

/**
 * Script para extrair sprites automaticamente do arquivo JPG
 * Assumindo layout: 2 linhas x 5 colunas (6000x3000 = 1200x600 por personagem)
 */

const fs = require('fs');
const path = require('path');

let sharp;
try {
    sharp = require('sharp');
} catch (e) {
    console.log('❌ Biblioteca "sharp" não encontrada.');
    console.log('📦 Instale com: npm install sharp');
    process.exit(1);
}

const inputFile = path.join(__dirname, '../public/sprites/2204_w053_n004_22_medicharacters_p1_22.jpg');
const outputDir = path.join(__dirname, '../public/sprites');

async function extractSprites() {
    console.log('🎨 Extraindo sprites do arquivo JPG...\n');
    
    if (!fs.existsSync(inputFile)) {
        console.error('❌ Arquivo não encontrado:', inputFile);
        process.exit(1);
    }
    
    try {
        const metadata = await sharp(inputFile).metadata();
        console.log(`📐 Dimensões: ${metadata.width}x${metadata.height}`);
        
        // Assumindo layout: 2 linhas x 5 colunas
        // Cada personagem: ~1200x600 pixels (6000/5 = 1200, 3000/2 = 1500, mas vamos usar 600)
        const cols = 5;
        const rows = 2;
        const charWidth = Math.floor(metadata.width / cols); // ~1200px
        const charHeight = Math.floor(metadata.height / rows); // ~1500px
        
        console.log(`📊 Layout detectado: ${cols} colunas x ${rows} linhas`);
        console.log(`📏 Tamanho por personagem: ~${charWidth}x${charHeight}px\n`);
        
        // Redimensionar cada personagem para 32x32 (tamanho do jogo)
        const targetSize = 64; // Vamos usar 64x64 para melhor qualidade
        
        // Linha 1: Movimento (sem arma) - frames 0-4
        const walkFrames = [];
        for (let col = 0; col < cols; col++) {
            const x = col * charWidth;
            const y = 0;
            
            // Extrair e redimensionar frame
            const frameBuffer = await sharp(inputFile)
                .extract({
                    left: x,
                    top: y,
                    width: charWidth,
                    height: charHeight
                })
                .resize(targetSize, targetSize, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .toBuffer();
            
            walkFrames.push(frameBuffer);
            console.log(`✅ Frame de movimento ${col + 1}/5 extraído`);
        }
        
        // Linha 2: Ataque (com martelo) - frames 5-9
        const attackFrames = [];
        for (let col = 0; col < cols; col++) {
            const x = col * charWidth;
            const y = charHeight;
            
            // Extrair e redimensionar frame
            const frameBuffer = await sharp(inputFile)
                .extract({
                    left: x,
                    top: y,
                    width: charWidth,
                    height: charHeight
                })
                .resize(targetSize, targetSize, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .toBuffer();
            
            attackFrames.push(frameBuffer);
            console.log(`✅ Frame de ataque ${col + 1}/5 extraído`);
        }
        
        // Criar sprite sheet de movimento
        const walkSheetWidth = targetSize * cols;
        const walkSheetHeight = targetSize;
        
        const walkComposites = walkFrames.map((frame, i) => ({
            input: frame,
            left: i * targetSize,
            top: 0
        }));
        
        await sharp({
            create: {
                width: walkSheetWidth,
                height: walkSheetHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite(walkComposites)
        .png()
        .toFile(path.join(outputDir, 'player_walk.png'));
        
        console.log(`\n✅ Sprite sheet criado: player_walk.png (${walkSheetWidth}x${walkSheetHeight}px)`);
        
        // Criar sprite sheet de ataque
        const attackComposites = attackFrames.map((frame, i) => ({
            input: frame,
            left: i * targetSize,
            top: 0
        }));
        
        await sharp({
            create: {
                width: walkSheetWidth,
                height: walkSheetHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite(attackComposites)
        .png()
        .toFile(path.join(outputDir, 'player_attack.png'));
        
        console.log(`✅ Sprite sheet criado: player_attack.png (${walkSheetWidth}x${walkSheetHeight}px)`);
        
        console.log('\n🎉 Sprites extraídos com sucesso!');
        console.log('📝 Nota: Os sprites foram criados com tamanho 64x64 por frame.');
        console.log('   Se quiser 32x32, edite o script e mude "targetSize" para 32.\n');
        
    } catch (error) {
        console.error('❌ Erro ao processar:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

extractSprites();

