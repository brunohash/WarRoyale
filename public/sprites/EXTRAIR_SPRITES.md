# 🎨 Como Extrair Sprites do Arquivo JPG

Você tem o arquivo `2204_w053_n004_22_medicharacters_p1_22.jpg` com os personagens. Vamos extrair os sprites!

## 📋 Opção 1: Usando Ferramenta Online (Mais Fácil)

### Passo a Passo:

1. **Acesse:** https://www.iloveimg.com/crop-image
2. **Faça upload** do arquivo `2204_w053_n004_22_medicharacters_p1_22.jpg`
3. **Recorte os frames:**
   - Identifique os 5 frames de movimento (personagens sem arma)
   - Identifique os 5 frames de ataque (personagens com martelo)
4. **Organize em sprite sheets:**
   - Crie `player_walk.png` com 5 frames lado a lado (160x32px)
   - Crie `player_attack.png` com 5 frames lado a lado (160x32px)
5. **Salve** na pasta `public/sprites/`

## 📋 Opção 2: Usando Photoshop/GIMP

1. **Abra** o arquivo JPG
2. **Identifique os frames:**
   - Olhe a imagem - você tem 10 personagens
   - 5 sem arma (movimento) na linha superior
   - 5 com martelo (ataque) na linha inferior
3. **Recorte cada frame:**
   - Cada personagem parece ter ~32x32 pixels
   - Recorte os 5 frames de movimento
   - Recorte os 5 frames de ataque
4. **Crie os sprite sheets:**
   - Nova imagem: 160x32px (5 frames x 32px)
   - Cole os 5 frames de movimento lado a lado → `player_walk.png`
   - Cole os 5 frames de ataque lado a lado → `player_attack.png`
5. **Exporte como PNG** com transparência

## 📋 Opção 3: Usando Script Automático (Avançado)

Se você souber as coordenadas exatas dos frames:

1. Instale a biblioteca:
   ```bash
   npm install sharp
   ```

2. Edite o script `scripts/processSprites.js` com as coordenadas

3. Execute:
   ```bash
   npm run process-sprites
   ```

## 🎯 Estrutura Esperada

Baseado na descrição da imagem que você mostrou:

```
Linha Superior (Movimento):
[Personagem 1][Personagem 2][Personagem 3][Personagem 4][Personagem 5]
   Sem arma      Sem arma      Sem arma      Sem arma      Sem arma

Linha Inferior (Ataque):
[Personagem 6][Personagem 7][Personagem 8][Personagem 9][Personagem 10]
  Com martelo    Com martelo    Com martelo    Com martelo    Com martelo
```

## ✅ Resultado Final

Você precisa ter:
- `public/sprites/player_walk.png` - 160x32px, 5 frames
- `public/sprites/player_attack.png` - 160x32px, 5 frames

## 💡 Dica

Se os personagens na imagem são maiores que 32x32, você pode:
1. Redimensionar cada frame para 32x32 antes de criar o sprite sheet
2. Ou ajustar o código para usar um tamanho maior (ex: 64x64)

Me avise qual tamanho você quer usar e eu ajusto o código!

