@echo off
REM Script para Windows - Iniciar servidor com túnel

echo 🎮 War Royale - Iniciando com Túnel
echo ====================================
echo.

REM Verificar se ngrok está instalado
where ngrok >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo ✅ ngrok encontrado!
    echo.
    echo Iniciando servidor na porta 3000...
    start /B npm start
    
    timeout /t 3 /nobreak >nul
    
    echo.
    echo 🌐 Iniciando túnel ngrok...
    echo ====================================
    ngrok http 3000
    exit
)

REM Se ngrok não estiver instalado
echo ⚠️  ngrok não encontrado.
echo.
echo 📥 Para instalar ngrok:
echo    1. Baixe em: https://ngrok.com/download
echo    2. Extraia ngrok.exe para uma pasta no PATH
echo    3. Ou coloque ngrok.exe na pasta do projeto
echo.
echo 💡 Alternativa: Use localhost.run manualmente
echo    Abra outro terminal e digite:
echo    ssh -R 80:localhost:3000 nokey@localhost.run
echo.
pause

