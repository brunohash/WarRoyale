const API_URL = window.location.origin;

// Gerenciar tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        
        // Atualizar botões
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Atualizar formulários
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.getElementById(`${tab}-form`).classList.add('active');
        
        // Limpar erros
        document.querySelectorAll('.error-message').forEach(e => e.textContent = '');
    });
});

async function handleLogin() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    
    if (!username || !password) {
        errorEl.textContent = 'Preencha todos os campos';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            errorEl.textContent = data.error || 'Erro ao fazer login';
            return;
        }
        
        // Salvar token
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Redirecionar para o jogo
        window.location.href = '/game.html';
    } catch (error) {
        errorEl.textContent = 'Erro de conexão. Tente novamente.';
        console.error('Erro no login:', error);
    }
}

async function handleRegister() {
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const errorEl = document.getElementById('register-error');
    
    if (!username || !password) {
        errorEl.textContent = 'Preencha todos os campos';
        return;
    }
    
    if (password.length < 6) {
        errorEl.textContent = 'Password deve ter pelo menos 6 caracteres';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            errorEl.textContent = data.error || 'Erro ao criar conta';
            return;
        }
        
        // Salvar token
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Redirecionar para o jogo
        window.location.href = '/game.html';
    } catch (error) {
        errorEl.textContent = 'Erro de conexão. Tente novamente.';
        console.error('Erro no registro:', error);
    }
}

// Permitir Enter nos inputs
document.getElementById('login-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
});

document.getElementById('register-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleRegister();
});

