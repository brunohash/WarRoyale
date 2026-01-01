#!/usr/bin/env node

/**
 * Script para processar sprites do arquivo JPG
 * Extrai frames e cria sprite sheets para o jogo
 */

const fs = require('fs');
const path = require('path');

// Verificar se sharp está disponível (biblioteca para processar imagens)
let sharp;
try {
    sharp = require('sharp');
} catch (e) {
    console.log('⚠️  Biblioteca "sharp" não encontrada.');
    console.log('📦 Instalando...');
    console.log('   Execute: npm install sharp');
    console.log('\n💡 Alternativa: Use uma ferramenta online como:');
    console.log('   - https://www.iloveimg.com/crop-image');
    console.log('   - https://ezgif.com/split');
    process.exit(1);
}

const inputFile = path.join(__dirname, '../public/sprites/2204_w053_n004_22_medicharacters_p1_22.jpg');
const outputDir = path.join(__dirname, '../public/sprites');

async function processSprites() {
    console.log('🎨 Processando sprites...\n');
    
    if (!fs.existsSync(inputFile)) {
        console.error('❌ Arquivo não encontrado:', inputFile);
        process.exit(1);
    }
    
    try {
        const metadata = await sharp(inputFile).metadata();
        console.log(`📐 Dimensões da imagem: ${metadata.width}x${metadata.height}`);
        console.log(`📊 Formato: ${metadata.format}\n`);
        
        // Tentar detectar o layout dos sprites
        // Assumindo que são 10 personagens (5 sem arma + 5 com arma)
        // Cada um com múltiplos frames
        
        console.log('💡 Para processar os sprites, você precisa:');
        console.log('   1. Abrir o arquivo JPG em um editor de imagens');
        console.log('   2. Identificar os frames de movimento (5 frames)');
        console.log('   3. Identificar os frames de ataque (5 frames)');
        console.log('   4. Recortar e organizar em sprite sheets\n');
        
        console.log('📋 Formato necessário:');
        console.log('   - player_walk.png: 160x32px (5 frames x 32px)');
        console.log('   - player_attack.png: 160x32px (5 frames x 32px)\n');
        
        // Se a imagem tiver um layout específico, podemos tentar extrair
        // Por enquanto, vamos criar um guia visual
        
        console.log('🔧 Criando preview da imagem...');
        const previewPath = path.join(outputDir, 'preview.jpg');
        await sharp(inputFile)
            .resize(800, null, { withoutEnlargement: true })
            .toFile(previewPath);
        
        console.log(`✅ Preview criado: ${previewPath}`);
        console.log('\n📖 Veja PROCESSAR_SPRITES.md para instruções detalhadas');
        
    } catch (error) {
        console.error('❌ Erro ao processar:', error.message);
        process.exit(1);
    }
}

// Função para criar sprite sheet a partir de coordenadas
async function createSpriteSheet(inputFile, frames, outputFile) {
    const frameWidth = 32;
    const frameHeight = 32;
    const sheetWidth = frameWidth * frames.length;
    const sheetHeight = frameHeight;
    
    const composites = frames.map((frame, index) => ({
        input: inputFile,
        left: frame.x,
        top: frame.y,
        width: frameWidth,
        height: frameHeight
    }));
    
    await sharp({
        create: {
            width: sheetWidth,
            height: sheetHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite(composites.map((comp, i) => ({
        input: await sharp(inputFile)
            .extract({
                left: comp.left,
                top: comp.top,
                width: comp.width,
                height: comp.height
            })
            .toBuffer(),
        left: i * frameWidth,
        top: 0
    })))
    .png()
    .toFile(outputFile);
    
    console.log(`✅ Sprite sheet criado: ${outputFile}`);
}

processSprites();

