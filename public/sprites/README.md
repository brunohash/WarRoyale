# 📁 Pasta de Sprites

Coloque seus arquivos de sprite aqui:

## Arquivos necessários:

1. **player_walk.png** - Sprite sheet com animação de movimento
   - 5 frames horizontais
   - Tamanho: 32x32 pixels por frame
   - Total: 160x32 pixels (5 frames x 32px)

2. **player_attack.png** - Sprite sheet com animação de ataque
   - 5 frames horizontais
   - Tamanho: 32x32 pixels por frame
   - Total: 160x32 pixels (5 frames x 32px)

## Formato esperado:

```
player_walk.png:
[Frame1][Frame2][Frame3][Frame4][Frame5]
  32px   32px   32px   32px   32px
```

## Como usar:

1. Coloque os arquivos `player_walk.png` e `player_attack.png` nesta pasta
2. Os sprites serão carregados automaticamente quando o jogo iniciar
3. Se os sprites não carregarem, o jogo usará um fallback (círculo azul)

## Estrutura do Sprite Sheet:

- **Linhas:** 1 linha
- **Colunas:** 5 colunas (frames)
- **Tamanho por frame:** 32x32 pixels
- **Formato:** PNG com transparência

