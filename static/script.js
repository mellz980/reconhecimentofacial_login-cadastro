/**
 * PORTARIA DIGITAL - JAVASCRIPT
 * Lógica do cliente para captura de webcam, anel de progresso SVG,
 * cadastro com vivacidade em voz ativa e crachá de credenciamento.
 */

document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('webcam');
    const canvas = document.getElementById('canvas');
    const snapshotEl = document.getElementById('visor-snapshot');
    const ringFill = document.getElementById('ring-fill');
    const visorWrapper = document.getElementById('visor-wrapper');
    const visorReason = document.getElementById('visor-reason');

    // Identificação da página
    const isRegisterPage = !!document.getElementById('form-register');
    const isLoginPage = !!document.getElementById('btn-login');

    let ringLength = 975; // Valor aproximado padrão para o SVG path 300x380
    if (ringFill) {
        try {
            if (typeof ringFill.getTotalLength === 'function') {
                const len = ringFill.getTotalLength();
                if (len && len > 0) {
                    ringLength = len;
                }
            }
        } catch (e) {
            console.warn('Usando extensão padrão para o anel SVG:', e);
        }
        ringFill.style.strokeDasharray = `${ringLength}`;
        ringFill.style.strokeDashoffset = `${ringLength}`;
    }

    // Inicializa a câmera se houver elemento de vídeo
    if (video) {
        initWebcam(video, visorReason);
    }

    if (isRegisterPage) {
        setupRegisterFlow(video, canvas, snapshotEl, ringFill, ringLength, visorWrapper, visorReason);
    }

    if (isLoginPage) {
        setupLoginFlow(video, canvas, snapshotEl, ringFill, ringLength, visorWrapper, visorReason);
    }
});

/**
 * Inicializa a webcam com mensagens claras de estado de permissão
 */
async function initWebcam(videoElement, reasonElement) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        updateVisorStatus(
            reasonElement,
            'Seu navegador ou ambiente (HTTP/Iframe) não permite acesso à câmera. Utilize HTTPS ou 127.0.0.1.',
            'warning'
        );
        return;
    }

    updateVisorStatus(reasonElement, 'Precisamos de acesso à sua câmera para identificar seu rosto no credenciamento.', '');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            },
            audio: false
        });
        videoElement.srcObject = stream;
        await videoElement.play().catch(e => console.warn('Erro ao reproduzir fluxo da câmera:', e));
        updateVisorStatus(reasonElement, '', ''); // Limpa mensagem de aviso
    } catch (err) {
        console.error('Erro de acesso à câmera:', err);
        updateVisorStatus(
            reasonElement, 
            'Libere a câmera nas configurações do navegador e recarregue a página.', 
            'warning'
        );
    }
}

/**
 * Captura o frame atual da webcam sem espelhamento para envio ao backend
 */
function captureFrameBase64(videoElement, canvasElement) {
    if (!videoElement || !videoElement.videoWidth || !videoElement.videoHeight) return null;

    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
    const ctx = canvasElement.getContext('2d');

    // Desenha direto (sem flip horizontal) para preservação do sinal original enviado ao servidor
    ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

    return canvasElement.toDataURL('image/jpeg', 0.85);
}

/**
 * Atualiza o preenchimento do anel SVG de progresso
 */
function setRingProgress(ringFill, ringLength, percentage, statusClass = '') {
    if (!ringFill) return;

    ringFill.setAttribute('class', `ring-fill ${statusClass}`.trim());

    if (percentage === null) {
        // Estado indeterminado / spinning
        return;
    }

    const clamped = Math.max(0, Math.min(100, percentage));
    const offset = ringLength - (ringLength * clamped / 100);
    ringFill.style.strokeDashoffset = `${offset}`;
}

/**
 * Atualiza a caixa de texto discreta sob o visor
 */
function updateVisorStatus(reasonElement, text, type = '') {
    if (!reasonElement) return;
    if (!text) {
        reasonElement.style.display = 'none';
        reasonElement.textContent = '';
        reasonElement.className = 'visor-reason';
    } else {
        reasonElement.style.display = 'inline-block';
        reasonElement.textContent = text;
        reasonElement.className = `visor-reason ${type}`.trim();
    }
}

/**
 * Configuração da Tela de Cadastro
 */
function setupRegisterFlow(video, canvas, snapshotEl, ringFill, ringLength, visorWrapper, visorReason) {
    const form = document.getElementById('form-register');
    const nameInput = document.getElementById('input-name');
    const btnStart = document.getElementById('btn-start-register');
    const instructionText = document.getElementById('instruction-text');
    const badgeCard = document.getElementById('badge-card');
    const panelForm = document.getElementById('panel-form-section');

    // Modal de confirmação para nome duplicado
    const modal = document.getElementById('modal-overwrite');
    const btnConfirmOverwrite = document.getElementById('btn-confirm-overwrite');
    const btnCancelOverwrite = document.getElementById('btn-cancel-overwrite');
    let pendingName = '';

    const instructions = [
        "Olhe de frente",
        "Olhe de frente",
        "Olhe de frente",
        "Vire um pouco para a esquerda",
        "Vire um pouco para a esquerda",
        "Vire um pouco para a esquerda",
        "Vire um pouco para a direita",
        "Vire um pouco para a direita",
        "Vire um pouco para a direita",
        "Incline levemente a cabeça",
        "Incline levemente a cabeça",
        "Incline levemente a cabeça"
    ];

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = nameInput.value.trim();
            if (!name) return;

            // Verifica se usuário existe antes da captura
            try {
                const res = await fetch('/api/check-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                const data = await res.json();

                if (data.exists) {
                    pendingName = name;
                    openModal(modal, `O rosto de "${name}" já está cadastrado no sistema. Deseja sobrescrever as credenciais?`);
                    return;
                }

                runCaptureProcess(name, false);
            } catch (err) {
                updateVisorStatus(visorReason, 'Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.', 'warning');
            }
        });
    }

    if (btnConfirmOverwrite) {
        btnConfirmOverwrite.addEventListener('click', () => {
            closeModal(modal);
            if (pendingName) {
                runCaptureProcess(pendingName, true);
            }
        });
    }

    if (btnCancelOverwrite) {
        btnCancelOverwrite.addEventListener('click', () => {
            closeModal(modal);
            pendingName = '';
        });
    }

    async function runCaptureProcess(name, overwrite) {
        if (btnStart) btnStart.disabled = true;
        const totalFrames = 12;
        const capturedFrames = [];

        setRingProgress(ringFill, ringLength, 0, '');

        for (let i = 0; i < totalFrames; i++) {
            // Atualiza instrução em voz ativa
            if (instructionText) {
                instructionText.textContent = instructions[i] || "Mantenha a posição";
                instructionText.className = 'instruction-text active';
            }

            const frameBase64 = captureFrameBase64(video, canvas);
            if (frameBase64) {
                capturedFrames.push(frameBase64);
            }

            const pct = Math.round(((i + 1) / totalFrames) * 100);
            setRingProgress(ringFill, ringLength, pct, '');

            await new Promise(r => setTimeout(r, 260));
        }

        if (instructionText) {
            instructionText.textContent = "Processando dados biométricos…";
            instructionText.className = 'instruction-text';
        }

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    frames: capturedFrames,
                    overwrite: overwrite
                })
            });

            const result = await response.json();

            if (response.ok && result.status === 'success') {
                // Sucesso: exibe congelamento no visor e revela o crachá
                const lastFrame = capturedFrames[capturedFrames.length - 1];
                if (snapshotEl && lastFrame) {
                    snapshotEl.style.backgroundImage = `url(${lastFrame})`;
                    snapshotEl.style.display = 'block';
                }

                setRingProgress(ringFill, ringLength, 100, 'success');
                
                if (panelForm) panelForm.style.display = 'none';
                revealBadge(badgeCard, 'success', `Rosto de ${name} cadastrado.`, `Cadastrado em ${new Date().toLocaleDateString('pt-BR')}`);
                
            } else {
                setRingProgress(ringFill, ringLength, 0, 'danger');
                let reasonText = result.message || 'Falha ao validar o rosto.';
                
                if (result.message && result.message.includes('Vivacidade')) {
                    reasonText = 'Movimento insuficiente. Movimente levemente a cabeça durante a captura.';
                } else if (result.message && result.message.includes('Nenhum rosto')) {
                    reasonText = 'Não encontrei seu rosto. Aproxime-se da câmera.';
                }
                
                updateVisorStatus(visorReason, reasonText, 'warning');
                if (btnStart) btnStart.disabled = false;
            }
        } catch (err) {
            setRingProgress(ringFill, ringLength, 0, 'danger');
            updateVisorStatus(visorReason, 'Erro de comunicação com o servidor. Tente novamente.', 'warning');
            if (btnStart) btnStart.disabled = false;
        }
    }
}

/**
 * Configuração da Tela de Login
 */
function setupLoginFlow(video, canvas, snapshotEl, ringFill, ringLength, visorWrapper, visorReason) {
    const btnLogin = document.getElementById('btn-login');
    const badgeCard = document.getElementById('badge-card');
    const panelMain = document.getElementById('panel-main-section');
    let lockoutTimer = null;

    if (!btnLogin) return;

    btnLogin.addEventListener('click', async () => {
        btnLogin.disabled = true;
        btnLogin.textContent = 'Verificando…';

        // Anel girando em estado de espera
        setRingProgress(ringFill, ringLength, 50, 'spinning');
        updateVisorStatus(visorReason, '', '');

        const frameBase64 = captureFrameBase64(video, canvas);
        if (!frameBase64) {
            setRingProgress(ringFill, ringLength, 0, 'danger');
            updateVisorStatus(visorReason, 'Câmera indisponível ou ainda inicializando. Verifique as permissões.', 'warning');
            btnLogin.disabled = false;
            btnLogin.textContent = 'Entrar';
            return;
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: frameBase64 })
            });

            const data = await response.json();

            if (response.status === 429 || data.status === 'locked_out') {
                // Bloqueio por tentativas excedidas
                setRingProgress(ringFill, ringLength, 100, 'danger');
                startLockoutCountdown(btnLogin, data.remaining_seconds || 30);
                updateVisorStatus(visorReason, 'Muitas tentativas incorretas. Aguarde o tempo limite.', 'warning');
                return;
            }

            if (data.access === 'granted') {
                // Sucesso: Acesso Liberado
                if (snapshotEl) {
                    snapshotEl.style.backgroundImage = `url(${frameBase64})`;
                    snapshotEl.style.display = 'block';
                }

                setRingProgress(ringFill, ringLength, 100, 'success');
                if (panelMain) panelMain.style.display = 'none';

                const simFormatted = (data.score || 0).toFixed(2).replace('.', ',');
                revealBadge(
                    badgeCard, 
                    'success', 
                    'ACESSO LIBERADO', 
                    `Bem-vindo, ${data.user_name}`, 
                    `Similaridade ${simFormatted}`
                );

            } else {
                // Falha: Acesso Negado
                triggerShake(visorWrapper);
                setRingProgress(ringFill, ringLength, 100, 'danger');

                let detailMsg = 'Rosto não reconhecido.';
                if (data.detail && data.detail.includes('Nenhum rosto')) {
                    detailMsg = 'Nenhum rosto detectado. Tente de novo.';
                }

                if (panelMain) panelMain.style.display = 'none';
                revealBadge(
                    badgeCard, 
                    'danger', 
                    'ACESSO NEGADO', 
                    detailMsg, 
                    data.score ? `Similaridade ${(data.score).toFixed(2).replace('.', ',')}` : ''
                );
            }

        } catch (err) {
            setRingProgress(ringFill, ringLength, 0, 'danger');
            updateVisorStatus(visorReason, 'Erro de rede ou do servidor. Clique para tentar novamente.', 'warning');
            btnLogin.disabled = false;
            btnLogin.textContent = 'Entrar';
        }
    });

    function startLockoutCountdown(button, seconds) {
        let remaining = seconds;
        button.disabled = true;
        button.textContent = `Muitas tentativas. Tente de novo em ${remaining} s.`;

        if (lockoutTimer) clearInterval(lockoutTimer);

        lockoutTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(lockoutTimer);
                button.disabled = false;
                button.textContent = 'Entrar';
                updateVisorStatus(visorReason, '', '');
                setRingProgress(ringFill, ringLength, 0, '');
            } else {
                button.textContent = `Muitas tentativas. Tente de novo em ${remaining} s.`;
            }
        }, 1000);
    }
}

/**
 * Animação de tremor no visor para o estado de negação
 */
function triggerShake(element) {
    if (!element) return;
    element.classList.remove('shake');
    void element.offsetWidth; // Repaint trigger
    element.classList.add('shake');
}

/**
 * Exibe o Crachá (Badge Card) de Resultado
 */
function revealBadge(badgeCard, statusType, titleText, subtitleText, metaText = '') {
    if (!badgeCard) return;

    const iconBox = badgeCard.querySelector('.badge-icon-status');
    const titleEl = badgeCard.querySelector('.badge-status-title');
    const nameEl = badgeCard.querySelector('.badge-user-name');
    const metaEl = badgeCard.querySelector('.badge-meta');
    const btnRetry = badgeCard.querySelector('#btn-badge-retry');
    const btnLogout = badgeCard.querySelector('#btn-badge-logout');

    if (statusType === 'success') {
        if (iconBox) {
            iconBox.className = 'badge-icon-status success';
            iconBox.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        }
        if (titleEl) {
            titleEl.className = 'badge-status-title success';
            titleEl.textContent = titleText;
        }
        if (btnRetry) btnRetry.style.display = 'none';
        if (btnLogout) btnLogout.style.display = 'inline-flex';
    } else {
        if (iconBox) {
            iconBox.className = 'badge-icon-status danger';
            iconBox.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        }
        if (titleEl) {
            titleEl.className = 'badge-status-title danger';
            titleEl.textContent = titleText;
        }
        if (btnRetry) btnRetry.style.display = 'inline-flex';
        if (btnLogout) btnLogout.style.display = 'none';
    }

    if (nameEl) nameEl.textContent = subtitleText || '';
    if (metaEl) metaEl.textContent = metaText || '';

    badgeCard.className = 'badge-card revealed';
}

/**
 * Controles do Modal de Confirmação
 */
function openModal(modalEl, textMessage) {
    if (!modalEl) return;
    const bodyText = modalEl.querySelector('.modal-text');
    if (bodyText) bodyText.textContent = textMessage;
    modalEl.classList.add('open');
    
    // Foco no botão de confirmação
    const confirmBtn = modalEl.querySelector('#btn-confirm-overwrite');
    if (confirmBtn) confirmBtn.focus();
}

function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('open');
}
