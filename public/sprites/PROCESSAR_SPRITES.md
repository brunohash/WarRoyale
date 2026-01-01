# 🎨 Como Processar os Sprites

Você colocou arquivos `.eps` e `.jpg` na pasta. O jogo precisa de arquivos PNG com formato específico.

## 📋 Arquivos Necessários

Você precisa criar 2 arquivos PNG:

1. **player_walk.png** - Sprite sheet com animação de movimento (5 frames)
2. **player_attack.png** - Sprite sheet com animação de ataque (5 frames)

## 🔧 Como Processar

### Opção 1: Usando Photoshop/GIMP

1. Abra o arquivo `.eps` ou `.jpg` no editor
2. Extraia os frames de movimento (5 frames lado a lado)
3. Extraia os frames de ataque (5 frames lado a lado)
4. Crie dois arquivos PNG:
   - `player_walk.png`: 160x32 pixels (5 frames x 32px)
   - `player_attack.png`: 160x32 pixels (5 frames x 32px)
5. Salve na pasta `public/sprites/`

### Opção 2: Usando Ferramentas Online

1. Use um editor online como:
   - https://www.piskelapp.com/
   - https://www.pixilart.com/
2. Crie os sprite sheets com 5 frames cada
3. Exporte como PNG
4. Coloque na pasta `public/sprites/`

### Opção 3: Converter o JPG existente

Se o JPG já tem os sprites organizados:

1. Abra o arquivo `.jpg` em um editor
2. Recorte e organize os frames
3. Crie os dois arquivos PNG necessários
4. Salve na pasta `public/sprites/`

## 📐 Formato Esperado

```
player_walk.png:
┌─────┬─────┬─────┬─────┬─────┐
│Frame│Frame│Frame│Frame│Frame│
│  1  │  2  │  3  │  4  │  5  │
│32x32│32x32│32x32│32x32│32x32│
└─────┴─────┴─────┴─────┴─────┘
Total: 160x32 pixels
```

## ✅ Checklist

- [ ] Arquivo `player_walk.png` criado (160x32px, 5 frames)
- [ ] Arquivo `player_attack.png` criado (160x32px, 5 frames)
- [ ] Arquivos salvos em `public/sprites/`
- [ ] Testar o jogo para ver se os sprites aparecem

## 🎯 Dica

Se você tiver os sprites individuais, posso criar um script para combiná-los automaticamente em sprite sheets!

