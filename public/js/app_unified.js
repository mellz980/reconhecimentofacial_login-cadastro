/**
 * FACE ACCESS - FRONTEND UNIFICADO (SINGLE PAGE APPLICATION)
 * 
 * Gerencia em uma única interface e sem recarregar a câmera:
 * 1. Terminal de Acesso Facial (com diagnóstico de 10 frames e margem)
 * 2. Cadastro Facial (com 5 capturas e consolidação pela média)
 * 3. Calibração Automática de Limiar (P95, P5, FAR, FRR)
 * 4. Gestão de Usuários Cadastrados (Listagem e Exclusão)
 */

document.addEventListener('DOMContentLoaded', async () => {
    // -------------------------------------------------------------
    // ELEMENTOS GLOBAIS & CÂMERA
    // -------------------------------------------------------------
    const video = document.getElementById('webcam');
    const canvasOverlay = document.getElementById('canvas-overlay');
    const ctx = canvasOverlay.getContext('2d');
    const ovalGuide = document.getElementById('oval-guide');
    const pillStatus = document.getElementById('pill-status');
    const pillText = document.getElementById('pill-text');
    const selectModo = document.getElementById('select-modo');

    // Navegação por Abas
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    let activeTab = 'acesso';

    // Estado da Biometria
    let currentMode = 'landmarks'; // 'landmarks' | 'modelo'
    let activeThreshold = 0.05;
    let currentFace = null;

    // -------------------------------------------------------------
    // CONTROLE DE NAVEGAÇÃO ENTRE ABAS
    // -------------------------------------------------------------
    function switchTab(tabId, updateHash = true) {
        activeTab = tabId;

        tabButtons.forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        tabPanes.forEach(pane => {
            if (pane.id === `tab-${tabId}`) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });

        if (updateHash) {
            history.replaceState(null, '', `#${tabId}`);
        }

        if (tabId === 'usuarios') {
            carregarListaUsuarios();
        }

        // Reseta estado transitório do visor
        ovalGuide.className = 'oval-guide';
        pillStatus.className = 'pill-status';
        pillText.textContent = 'Posicione o rosto';
    }

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });

    // Detecta hash ou pathname na URL inicial (ex: /#cadastro ou /cadastro)
    const initialHash = window.location.hash.replace('#', '');
    const pathSlug = window.location.pathname.replace('/', '').toLowerCase();
    const targetTab = (['acesso', 'cadastro', 'calibracao', 'usuarios'].includes(initialHash))
        ? initialHash
        : (['acesso', 'cadastro', 'calibracao', 'usuarios'].includes(pathSlug) ? pathSlug : 'acesso');

    switchTab(targetTab, false);

    // -------------------------------------------------------------
    // CONFIGURAÇÕES DO SERVIDOR
    // -------------------------------------------------------------
    async function carregarConfiguracao() {
        try {
            const res = await fetch('/config');
            const cfg = await res.json();
            currentMode = cfg.embeddingMode || 'landmarks';
            activeThreshold = cfg.limiarAtivo || 0.05;
            if (selectModo) selectModo.value = currentMode;
            atualizarPainelLimiar(activeThreshold, currentMode);
            appendLog(`[SISTEMA] Configurações carregadas. Modo ativo: ${currentMode}, Limiar: ${activeThreshold}`, 'info');
        } catch (e) {
            console.warn('Erro ao carregar /config:', e);
        }
    }
    await carregarConfiguracao();

    if (selectModo) {
        selectModo.addEventListener('change', async (e) => {
            currentMode = e.target.value;
            consecutiveFrames = [];
            atualizarDotsBuffer(0);
            try {
                const res = await fetch('/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ embeddingMode: currentMode })
                });
                const data = await res.json();
                activeThreshold = data.limiarAtivo;
                atualizarPainelLimiar(activeThreshold, currentMode);
                appendLog(`[CONFIG] Modo alternado para '${currentMode}'. Limiar ativo: ${activeThreshold}`, 'info');
            } catch (err) {
                console.error(err);
            }
        });
    }

    // -------------------------------------------------------------
    // INICIALIZAÇÃO CONTÍNUA DA WEBCAM & MEDIAPIPE
    // -------------------------------------------------------------
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
            audio: false
        });
        video.srcObject = stream;
        await video.play();
        canvasOverlay.width = video.videoWidth || 640;
        canvasOverlay.height = video.videoHeight || 480;
    } catch (err) {
        pillStatus.className = 'pill-status denied';
        pillText.textContent = 'Câmera não permitida';
        appendLog(`[ERRO CÂMERA] Permissão negada ou câmera ausente: ${err.message}`, 'warning');
    }

    let faceMesh = null;
    if (typeof FaceMesh !== 'undefined') {
        faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.6
        });

        faceMesh.onResults(onFaceResults);

        async function loopVideo() {
            if (video.readyState >= 2 && !video.paused) {
                try { await faceMesh.send({ image: video }); } catch (e) {}
            }
            requestAnimationFrame(loopVideo);
        }
        loopVideo();
        appendLog('[BIOMETRIA] MediaPipe FaceMesh ativo no navegador.', 'info');
    }

    // -------------------------------------------------------------
    // LOOP PRINCIPAL DE DETECÇÃO FACIAL
    // -------------------------------------------------------------
    function onFaceResults(results) {
        ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        const faces = results.multiFaceLandmarks;

        if (!faces || faces.length === 0) {
            currentFace = null;
            if (activeTab === 'acesso' && Date.now() > cooldownUntil) {
                consecutiveFrames = [];
                atualizarDotsBuffer(0);
                pillStatus.className = 'pill-status';
                pillText.textContent = 'Posicione o rosto';
                ovalGuide.className = 'oval-guide';
            }
            return;
        }

        currentFace = faces[0];

        // Desenho dos 90 landmarks anatômicos estáveis (exclui boca e sobrancelhas)
        desenharLandmarksEstaveis(currentFace);

        // Despacha o processamento conforme a aba ativa
        if (activeTab === 'acesso') {
            processarFrameAcesso(currentFace);
        } else if (activeTab === 'cadastro' && !isCapturingCadastro) {
            ovalGuide.className = 'oval-guide tracking';
            pillStatus.className = 'pill-status active';
            pillText.textContent = 'Rosto pronto para cadastro';
        } else if (activeTab === 'calibracao') {
            ovalGuide.className = 'oval-guide tracking';
        }
    }

    function desenharLandmarksEstaveis(face) {
        const w = canvasOverlay.width;
        const h = canvasOverlay.height;
        ctx.fillStyle = activeTab === 'cadastro' ? '#10B981' : (activeTab === 'calibracao' ? '#8B5CF6' : '#06B6D4');

        for (const idx of FaceLandmarks.STABLE_LANDMARK_INDICES) {
            const pt = face[idx];
            if (pt) {
                ctx.beginPath();
                ctx.arc(pt.x * w, pt.y * h, 2.2, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
    }

    // =============================================================
    // ABA 1: TERMINAL DE ACESSO FACIAL (DIAGNÓSTICO 10 FRAMES)
    // =============================================================
    const valMelhor = document.getElementById('val-melhor');
    const metaMelhor = document.getElementById('meta-melhor');
    const valSegundo = document.getElementById('val-segundo');
    const metaSegundo = document.getElementById('meta-segundo');
    const valMargem = document.getElementById('val-margem');
    const metaMargem = document.getElementById('meta-margem');
    const valLimiar = document.getElementById('val-limiar');
    const metaLimiar = document.getElementById('meta-limiar');
    const bannerResultado = document.getElementById('banner-resultado');
    const terminalLogs = document.getElementById('terminal-logs');
    const bufferDots = document.querySelectorAll('.buffer-dot');
    const bufferCount = document.getElementById('buffer-count');

    let consecutiveFrames = [];
    const MAX_FRAMES = 10;
    let isVerifying = false;
    let cooldownUntil = 0;

    async function processarFrameAcesso(face) {
        const now = Date.now();
        if (now < cooldownUntil || isVerifying) return;

        ovalGuide.className = 'oval-guide tracking';
        pillStatus.className = 'pill-status active';
        pillText.textContent = `Analisando (${consecutiveFrames.length + 1}/${MAX_FRAMES})`;

        try {
            if (currentMode === 'modelo') {
                if (typeof OnnxFaceEngine !== 'undefined') {
                    const emb = await OnnxFaceEngine.extractEmbedding(video, face);
                    if (emb) consecutiveFrames.push(emb);
                }
            } else {
                const stablePts = FaceLandmarks.extractStableLandmarks(face);
                const normPts = FaceLandmarks.normalizeLandmarks(stablePts);
                consecutiveFrames.push(normPts);
            }

            atualizarDotsBuffer(consecutiveFrames.length);

            if (consecutiveFrames.length >= MAX_FRAMES) {
                isVerifying = true;
                pillText.textContent = 'Validando biometria…';
                await enviarVerificacao([...consecutiveFrames]);
                consecutiveFrames = [];
                isVerifying = false;
            }
        } catch (err) {
            console.error('Erro na verificação de frame:', err);
        }
    }

    function atualizarDotsBuffer(count) {
        if (bufferCount) bufferCount.textContent = `${count}/${MAX_FRAMES}`;
        bufferDots.forEach((dot, idx) => {
            dot.classList.remove('filled', 'complete');
            if (idx < count) {
                dot.classList.add(count === MAX_FRAMES ? 'complete' : 'filled');
            }
        });
    }

    async function enviarVerificacao(framesBatch) {
        try {
            const res = await fetch('/verificar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    frames: framesBatch,
                    modo: currentMode
                })
            });

            const data = await res.json();
            exibirDiagnostico(data);
        } catch (err) {
            appendLog(`[ERRO DE CONEXÃO] ${err.message}`, 'warning');
        }
    }

    function exibirDiagnostico(data) {
        cooldownUntil = Date.now() + 2500;

        const distMelhorStr = data.distanciaMelhor !== null ? data.distanciaMelhor.toFixed(4) : '--';
        const distSegundoStr = data.distanciaSegundo !== null ? data.distanciaSegundo.toFixed(4) : '--';
        const margemStr = data.razaoMargem !== null ? `${data.razaoMargem}x` : '--';
        const limiarStr = data.limiar !== null ? data.limiar.toFixed(4) : activeThreshold.toFixed(4);

        if (valMelhor) valMelhor.textContent = distMelhorStr;
        if (metaMelhor) metaMelhor.textContent = data.melhorCandidato ? `Candidato: ${data.melhorCandidato}` : 'Nenhum cadastro';

        if (valSegundo) valSegundo.textContent = distSegundoStr;
        if (metaSegundo) metaSegundo.textContent = data.segundoCandidato ? `Candidato: ${data.segundoCandidato}` : 'Apenas 1 pessoa';

        if (valMargem) valMargem.textContent = margemStr;
        if (metaMargem) {
            if (data.razaoMargem !== null) {
                metaMargem.textContent = data.margemAtendida ? '✅ Margem >= 1.3x atendida' : '❌ Margem < 1.3x insuficiente';
                metaMargem.style.color = data.margemAtendida ? 'var(--emerald-400)' : 'var(--rose-400)';
            } else {
                metaMargem.textContent = 'Exigência ativa para 2+ pessoas';
                metaMargem.style.color = 'var(--text-secondary)';
            }
        }

        atualizarPainelLimiar(data.limiar, data.modo);

        if (data.aprovado) {
            ovalGuide.className = 'oval-guide success';
            pillStatus.className = 'pill-status success';
            pillText.textContent = 'Acesso Liberado';

            bannerResultado.className = 'access-result-banner granted';
            bannerResultado.innerHTML = `
                <div class="result-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <div>
                    <div class="result-title" style="color: var(--emerald-400);">ACESSO LIBERADO</div>
                    <div class="result-desc">Bem-vindo(a), <strong>${data.usuario}</strong>! (Distância: ${distMelhorStr} < ${limiarStr})</div>
                </div>
            `;

            appendLog(`[ACESSO LIBERADO] Usuário: '${data.usuario}' | d1: ${distMelhorStr} | d2: ${distSegundoStr} | Margem: ${margemStr} | Limiar: ${limiarStr}`, 'granted');
        } else {
            ovalGuide.className = 'oval-guide denied';
            pillStatus.className = 'pill-status denied';
            pillText.textContent = 'Acesso Negado';

            bannerResultado.className = 'access-result-banner denied';
            bannerResultado.innerHTML = `
                <div class="result-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </div>
                <div>
                    <div class="result-title" style="color: var(--rose-400);">ACESSO NEGADO</div>
                    <div class="result-desc">${data.motivo || 'Rosto não reconhecido ou critérios biométricos não satisfeitos.'}</div>
                </div>
            `;

            appendLog(`[ACESSO NEGADO] Melhor: '${data.melhorCandidato || 'Desconhecido'}' (d1: ${distMelhorStr}) | 2º: '${data.segundoCandidato || 'N/A'}' (d2: ${distSegundoStr}) | Limiar: ${limiarStr} | Motivo: ${data.motivo}`, 'denied');
        }
    }

    function atualizarPainelLimiar(limiar, modo) {
        if (valLimiar) valLimiar.textContent = typeof limiar === 'number' ? limiar.toFixed(4) : '--';
        if (metaLimiar) metaLimiar.textContent = `Modo: ${modo === 'modelo' ? 'MobileFaceNet 512D' : 'Landmarks Estáveis (90p)'}`;
    }

    function appendLog(msg, type = 'info') {
        if (!terminalLogs) return;
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const timeStr = new Date().toLocaleTimeString('pt-BR');
        entry.innerHTML = `<span class="time">[${timeStr}]</span>${msg}`;
        terminalLogs.appendChild(entry);
        terminalLogs.scrollTop = terminalLogs.scrollHeight;
    }


    // =============================================================
    // ABA 2: CADASTRO FACIAL (5 CAPTURAS E MÉDIA)
    // =============================================================
    const formRegister = document.getElementById('form-register');
    const inputNome = document.getElementById('input-name');
    const btnCadastrar = document.getElementById('btn-start-register');
    const instructionBox = document.getElementById('instruction-box');
    const instructionText = document.getElementById('instruction-text');
    const badgeSuccess = document.getElementById('badge-success');
    const registeredNameEl = document.getElementById('registered-name');

    const modalOverwrite = document.getElementById('modal-overwrite');
    const btnConfirmOverwrite = document.getElementById('btn-confirm-overwrite');
    const btnCancelOverwrite = document.getElementById('btn-cancel-overwrite');
    const modalText = document.getElementById('modal-text');

    let isCapturingCadastro = false;
    let pendingName = '';

    formRegister.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = inputNome.value.trim();
        if (!nome) return;

        if (!currentFace) {
            alert('Por favor, posicione seu rosto na câmera antes de iniciar o cadastro.');
            return;
        }

        pendingName = nome;
        await iniciarCapturaCadastro(nome, false);
    });

    if (btnConfirmOverwrite) {
        btnConfirmOverwrite.addEventListener('click', async () => {
            modalOverwrite.style.display = 'none';
            if (pendingName) {
                await iniciarCapturaCadastro(pendingName, true);
            }
        });
    }

    if (btnCancelOverwrite) {
        btnCancelOverwrite.addEventListener('click', () => {
            modalOverwrite.style.display = 'none';
            btnCadastrar.disabled = false;
        });
    }

    async function iniciarCapturaCadastro(nome, sobrescrever) {
        isCapturingCadastro = true;
        btnCadastrar.disabled = true;
        const totalCapturas = 5;
        const capturas = [];

        instructionBox.style.display = 'block';
        pillStatus.className = 'pill-status active';
        ovalGuide.className = 'oval-guide tracking';

        const orientacoes = [
            'Olhe diretamente para a câmera (1/5)',
            'Mantenha a posição frontal (2/5)',
            'Incline levemente a cabeça (3/5)',
            'Vire sutilmente para a esquerda (4/5)',
            'Vire sutilmente para a direita (5/5)'
        ];

        for (let i = 0; i < totalCapturas; i++) {
            instructionText.textContent = orientacoes[i];
            pillText.textContent = `Capturando amostra ${i + 1} de ${totalCapturas}…`;

            await new Promise(r => setTimeout(r, 450));

            if (!currentFace) {
                instructionText.textContent = 'Mantenha o rosto na câmera!';
                i--;
                await new Promise(r => setTimeout(r, 600));
                continue;
            }

            if (currentMode === 'modelo') {
                if (typeof OnnxFaceEngine !== 'undefined') {
                    const emb = await OnnxFaceEngine.extractEmbedding(video, currentFace);
                    if (emb) capturas.push(emb);
                }
            } else {
                const stablePts = FaceLandmarks.extractStableLandmarks(currentFace);
                const normPts = FaceLandmarks.normalizeLandmarks(stablePts);
                capturas.push(normPts);
            }
        }

        instructionText.textContent = 'Processando e salvando a média das capturas…';

        try {
            const res = await fetch('/cadastrar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nome,
                    capturas,
                    modo: currentMode,
                    sobrescrever
                })
            });

            const data = await res.json();

            if (res.status === 409 && data.duplicado) {
                modalText.textContent = data.mensagem;
                modalOverwrite.style.display = 'flex';
                isCapturingCadastro = false;
                return;
            }

            if (res.ok && data.status === 'ok') {
                ovalGuide.className = 'oval-guide success';
                pillStatus.className = 'pill-status success';
                pillText.textContent = 'Cadastrado com sucesso!';

                formRegister.style.display = 'none';
                badgeSuccess.style.display = 'flex';
                if (registeredNameEl) registeredNameEl.textContent = nome;
                appendLog(`[CADASTRO] Usuário '${nome}' cadastrado com sucesso.`, 'granted');
            } else {
                alert(`Erro ao cadastrar: ${data.error || 'Falha desconhecida.'}`);
                btnCadastrar.disabled = false;
            }
        } catch (err) {
            alert(`Erro de comunicação com o servidor: ${err.message}`);
            btnCadastrar.disabled = false;
        } finally {
            isCapturingCadastro = false;
        }
    }

    document.getElementById('btn-reset-cadastro')?.addEventListener('click', () => {
        formRegister.style.display = 'flex';
        badgeSuccess.style.display = 'none';
        btnCadastrar.disabled = false;
        inputNome.value = '';
        instructionBox.style.display = 'none';
    });


    // =============================================================
    // ABA 3: CALIBRAÇÃO AUTOMÁTICA DE LIMIAR
    // =============================================================
    const btnCollectGen = document.getElementById('btn-collect-genuine');
    const btnCollectImp = document.getElementById('btn-collect-impostor');
    const btnSimulateImp = document.getElementById('btn-simulate-impostor');
    const btnSaveCalibration = document.getElementById('btn-save-calibration');

    const countGenEl = document.getElementById('count-genuine');
    const countImpEl = document.getElementById('count-impostor');

    const valP95 = document.getElementById('val-p95');
    const valP5 = document.getElementById('val-p5');
    const valLimiarCalib = document.getElementById('val-limiar-calib');
    const valFar = document.getElementById('val-far');
    const valFrr = document.getElementById('val-frr');

    const thresholdLine = document.getElementById('threshold-line');
    const thresholdLabel = document.getElementById('threshold-label');

    let genuineCaptures = [];
    let impostorCaptures = [];
    let calibrationResult = null;

    // Carrega calibração anterior se existir
    try {
        const res = await fetch('/api/calibracao');
        const data = await res.json();
        if (data.calibrado && data.dados) {
            exibirMetricasCalibracao(data.dados);
        }
    } catch (e) {}

    btnCollectGen.addEventListener('click', async () => {
        if (!currentFace) {
            alert('Posicione seu rosto na câmera para iniciar a coleta.');
            return;
        }

        btnCollectGen.disabled = true;
        genuineCaptures = [];
        const total = 30;

        for (let i = 0; i < total; i++) {
            pillStatus.className = 'pill-status active';
            pillText.textContent = `Coletando "Sou Eu": ${i + 1}/${total}`;
            await new Promise(r => setTimeout(r, 120));

            if (currentFace) {
                const stablePts = FaceLandmarks.extractStableLandmarks(currentFace);
                const normPts = FaceLandmarks.normalizeLandmarks(stablePts);
                genuineCaptures.push(normPts);
                countGenEl.textContent = `${genuineCaptures.length} amostras`;
            }
        }

        pillStatus.className = 'pill-status success';
        pillText.textContent = 'Amostras genuínas coletadas!';
        btnCollectGen.disabled = false;
        verificarEExecutarCalibracao();
    });

    btnCollectImp.addEventListener('click', async () => {
        if (!currentFace) {
            alert('Posicione a outra pessoa na câmera para coletar amostras impostoras.');
            return;
        }

        btnCollectImp.disabled = true;
        impostorCaptures = [];
        const total = 30;

        for (let i = 0; i < total; i++) {
            pillStatus.className = 'pill-status active';
            pillText.textContent = `Coletando "Outra Pessoa": ${i + 1}/${total}`;
            await new Promise(r => setTimeout(r, 120));

            if (currentFace) {
                const stablePts = FaceLandmarks.extractStableLandmarks(currentFace);
                const normPts = FaceLandmarks.normalizeLandmarks(stablePts);
                impostorCaptures.push(normPts);
                countImpEl.textContent = `${impostorCaptures.length} amostras`;
            }
        }

        pillStatus.className = 'pill-status success';
        pillText.textContent = 'Amostras impostoras coletadas!';
        btnCollectImp.disabled = false;
        verificarEExecutarCalibracao();
    });

    if (btnSimulateImp) {
        btnSimulateImp.addEventListener('click', () => {
            if (genuineCaptures.length === 0) {
                alert('Colete primeiro as amostras genuínas ("Sou Eu") para simular impostores matemáticos de referência.');
                return;
            }

            impostorCaptures = [];
            const meanGen = FaceLandmarks.computeMeanLandmarks(genuineCaptures);

            for (let k = 0; k < 35; k++) {
                const scaleH = 1.25 - 0.4 * Math.cos(k * 1.7);
                const pts = meanGen.map((p, idx) => ({
                    x: p.x * (1 + 0.25 * Math.sin(idx * 0.4 + k)),
                    y: p.y * scaleH,
                    z: -p.z * 1.2
                }));
                impostorCaptures.push(FaceLandmarks.normalizeLandmarks(pts));
            }

            countImpEl.textContent = `${impostorCaptures.length} amostras (sintéticas)`;
            verificarEExecutarCalibracao();
        });
    }

    function verificarEExecutarCalibracao() {
        if (genuineCaptures.length < 10 || impostorCaptures.length < 10) return;

        const meanGen = FaceLandmarks.computeMeanLandmarks(genuineCaptures);
        const genDistances = genuineCaptures.map(c => FaceLandmarks.calculateDistance(c, meanGen));
        const impDistances = impostorCaptures.map(c => FaceLandmarks.calculateDistance(c, meanGen));

        calibrationResult = FaceLandmarks.calculateCalibration(genDistances, impDistances);
        exibirMetricasCalibracao(calibrationResult);

        if (btnSaveCalibration) btnSaveCalibration.disabled = false;
    }

    function exibirMetricasCalibracao(res) {
        if (valP95) valP95.textContent = res.p95Genuino !== null ? res.p95Genuino.toFixed(4) : '--';
        if (valP5) valP5.textContent = res.p5Impostor !== null ? res.p5Impostor.toFixed(4) : '--';
        if (valLimiarCalib) valLimiarCalib.textContent = res.limiar !== null ? res.limiar.toFixed(4) : '--';
        if (valFar) valFar.textContent = `${res.far}%`;
        if (valFrr) valFrr.textContent = `${res.frr}%`;

        const maxScale = 0.15;
        const pctThreshold = Math.min(100, Math.max(0, (res.limiar / maxScale) * 100));

        if (thresholdLine) thresholdLine.style.left = `${pctThreshold}%`;
        if (thresholdLabel) {
            thresholdLabel.style.left = `${pctThreshold}%`;
            thresholdLabel.textContent = `Limiar: ${res.limiar.toFixed(4)}`;
        }
    }

    if (btnSaveCalibration) {
        btnSaveCalibration.addEventListener('click', async () => {
            if (!calibrationResult) return;
            btnSaveCalibration.disabled = true;

            try {
                const res = await fetch('/calibracao', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(calibrationResult)
                });

                const data = await res.json();
                if (res.ok) {
                    activeThreshold = calibrationResult.limiar;
                    atualizarPainelLimiar(activeThreshold, currentMode);
                    alert(`✅ Novo limiar de ${calibrationResult.limiar} ativado e salvo em data/calibracao.json!`);
                    appendLog(`[CALIBRAÇÃO] Limiar atualizado para ${calibrationResult.limiar} (FAR: ${calibrationResult.far}%, FRR: ${calibrationResult.frr}%)`, 'info');
                } else {
                    alert(`Erro ao salvar: ${data.error}`);
                }
            } catch (err) {
                alert(`Erro de comunicação com o servidor: ${err.message}`);
            } finally {
                btnSaveCalibration.disabled = false;
            }
        });
    }


    // =============================================================
    // ABA 4: USUÁRIOS CADASTRADOS (GESTÃO & EXCLUSÃO)
    // =============================================================
    const tableBody = document.getElementById('users-table-body');
    const totalUsersCountEl = document.getElementById('total-users-count');

    async function carregarListaUsuarios() {
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">Carregando usuários cadastrados…</td></tr>`;

        try {
            const res = await fetch('/pessoas');
            const data = await res.json();
            const pessoas = data.pessoas || [];

            if (totalUsersCountEl) totalUsersCountEl.textContent = `${pessoas.length} cadastrados`;

            if (pessoas.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">Nenhuma pessoa cadastrada no momento. Use a aba "Cadastrar Rosto" para cadastrar.</td></tr>`;
                return;
            }

            tableBody.innerHTML = pessoas.map(p => {
                const dataFormatada = p.criadoEm ? new Date(p.criadoEm).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--';
                return `
                    <tr>
                        <td style="font-weight: 600;">${p.nome}</td>
                        <td><span class="badge-mode">${p.versaoModelo || 'landmarks-v1'}</span></td>
                        <td>${p.amostras || 5} capturas</td>
                        <td style="color: var(--text-muted); font-size: 0.8rem;">${dataFormatada}</td>
                        <td style="text-align: right;">
                            <button class="btn-icon-danger" onclick="excluirUsuario('${encodeURIComponent(p.nome)}')">Excluir</button>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--rose-400); padding: 20px;">Falha ao carregar lista de usuários: ${err.message}</td></tr>`;
        }
    }

    window.excluirUsuario = async function(nomeEncoded) {
        const nome = decodeURIComponent(nomeEncoded);
        if (!confirm(`Deseja realmente excluir as credenciais biométricas de "${nome}"?`)) return;

        try {
            const res = await fetch(`/pessoas/${encodeURIComponent(nome)}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) {
                appendLog(`[GESTÃO] Usuário '${nome}' removido.`, 'warning');
                carregarListaUsuarios();
            } else {
                alert(`Erro ao excluir: ${data.error}`);
            }
        } catch (err) {
            alert(`Erro de comunicação: ${err.message}`);
        }
    };
});
