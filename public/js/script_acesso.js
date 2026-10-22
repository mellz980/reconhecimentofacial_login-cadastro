/**
 * FACE ACCESS - CLIENTE DE ACESSO E PAINEL DIAGNÓSTICO
 * 
 * Regras implementadas:
 * - Janela temporal de 10 frames consecutivos
 * - Desenho exclusivo dos 90 landmarks estáveis (sem boca e sem sobrancelhas)
 * - Exibição em tempo real: melhor candidato, 2º melhor, razão de margem e limiar
 * - Suporte isomórfico aos modos "landmarks" e "modelo" (MobileFaceNet 512D)
 */

document.addEventListener('DOMContentLoaded', async () => {
    const video = document.getElementById('webcam');
    const canvasOverlay = document.getElementById('canvas-overlay');
    const ctx = canvasOverlay.getContext('2d');
    const ovalGuide = document.getElementById('oval-guide');
    const pillStatus = document.getElementById('pill-status');
    const pillText = document.getElementById('pill-text');

    // Elementos do painel de diagnóstico
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
    const selectModo = document.getElementById('select-modo');
    const bufferDots = document.querySelectorAll('.buffer-dot');
    const bufferCount = document.getElementById('buffer-count');

    let currentMode = 'landmarks'; // 'landmarks' | 'modelo'
    let activeThreshold = 0.05;
    let consecutiveFrames = [];
    const MAX_FRAMES = 10;
    let isVerifying = false;
    let cooldownUntil = 0;
    let lastDecision = null;

    // 1. Carrega configuração do servidor
    try {
        const res = await fetch('/config');
        const cfg = await res.json();
        currentMode = cfg.embeddingMode || 'landmarks';
        activeThreshold = cfg.limiarAtivo || 0.05;
        if (selectModo) selectModo.value = currentMode;
        atualizarPainelLimiar(activeThreshold, currentMode);
        appendLog(`[SISTEMA] Configurações carregadas. Modo ativo: ${currentMode}, Limiar: ${activeThreshold}`, 'info');
    } catch (e) {
        console.warn('Falha ao obter /config:', e);
    }

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

    // 2. Inicializa Câmera
    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
                audio: false
            });
            video.srcObject = stream;
            await video.play();
            canvasOverlay.width = video.videoWidth || 640;
            canvasOverlay.height = video.videoHeight || 480;
            appendLog('[CÂMERA] Fluxo de vídeo capturado com sucesso.', 'info');
        } catch (err) {
            appendLog(`[CÂMERA ERRO] Falha ao acessar webcam: ${err.message}`, 'warning');
            pillStatus.className = 'pill-status denied';
            pillText.textContent = 'Câmera indisponível';
        }
    }

    await startCamera();

    // 3. Inicializa MediaPipe FaceMesh
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

        // Loop de processamento de frames via requestAnimationFrame
        async function processVideoFrame() {
            if (video.readyState >= 2 && !video.paused) {
                try {
                    await faceMesh.send({ image: video });
                } catch (e) {
                    // Ignora falhas pontuais de frame
                }
            }
            requestAnimationFrame(processVideoFrame);
        }
        processVideoFrame();
        appendLog('[BIOMETRIA] MediaPipe FaceMesh inicializado no navegador.', 'info');
    } else {
        appendLog('[AVISO] Biblioteca MediaPipe carregando ou indisponível via CDN. Modo de demonstração ativo.', 'warning');
    }

    // 4. Callback de Detecção Facial
    async function onFaceResults(results) {
        ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

        const faces = results.multiFaceLandmarks;
        const now = Date.now();

        if (!faces || faces.length === 0) {
            // Nenhum rosto detectado
            if (now > cooldownUntil) {
                consecutiveFrames = [];
                atualizarDotsBuffer(0);
                pillStatus.className = 'pill-status';
                pillText.textContent = 'Posicione o rosto';
                ovalGuide.className = 'oval-guide';
            }
            return;
        }

        const face = faces[0];
        ovalGuide.className = 'oval-guide tracking';

        // DESENHA APENAS OS 90 PONTOS ESTÁVEIS (EXCLUI BOCA E SOBRANCELHAS)
        desenharLandmarksEstaveis(face);

        if (now < cooldownUntil || isVerifying) {
            return;
        }

        pillStatus.className = 'pill-status active';
        pillText.textContent = `Analisando (${consecutiveFrames.length + 1}/${MAX_FRAMES})`;

        try {
            if (currentMode === 'modelo') {
                // Modo Modelo Treinado MobileFaceNet 512D
                if (typeof OnnxFaceEngine !== 'undefined') {
                    const emb = await OnnxFaceEngine.extractEmbedding(video, face);
                    if (emb) {
                        consecutiveFrames.push(emb);
                    }
                }
            } else {
                // Modo Landmarks Estáveis (90 pontos)
                const stablePts = FaceLandmarks.extractStableLandmarks(face);
                const normPts = FaceLandmarks.normalizeLandmarks(stablePts);
                consecutiveFrames.push(normPts);
            }

            atualizarDotsBuffer(consecutiveFrames.length);

            // Quando atinge exatamente 10 frames consecutivos
            if (consecutiveFrames.length >= MAX_FRAMES) {
                isVerifying = true;
                pillText.textContent = 'Validando biometria…';
                await enviarVerificacao([...consecutiveFrames]);
                consecutiveFrames = [];
                isVerifying = false;
            }
        } catch (err) {
            console.error('Erro na captura do frame:', err);
        }
    }

    // 5. Desenha exclusivamente os 90 pontos estáveis
    function desenharLandmarksEstaveis(allLandmarks) {
        const w = canvasOverlay.width;
        const h = canvasOverlay.height;
        ctx.fillStyle = '#06B6D4'; // Cyan neon

        for (const idx of FaceLandmarks.STABLE_LANDMARK_INDICES) {
            const pt = allLandmarks[idx];
            if (pt) {
                const px = pt.x * w;
                const py = pt.y * h;
                ctx.beginPath();
                ctx.arc(px, py, 2.2, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
    }

    // 6. Atualiza contador de 10 dots
    function atualizarDotsBuffer(count) {
        if (bufferCount) bufferCount.textContent = `${count}/${MAX_FRAMES}`;
        bufferDots.forEach((dot, idx) => {
            dot.classList.remove('filled', 'complete');
            if (idx < count) {
                dot.classList.add(count === MAX_FRAMES ? 'complete' : 'filled');
            }
        });
    }

    // 7. Envio da janela temporal de 10 frames para /verificar
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

    // 8. Renderização completa dos dados no Painel de Diagnóstico
    function exibirDiagnostico(data) {
        cooldownUntil = Date.now() + 2500; // 2.5s para visualização do resultado

        // Diagnóstico numérico
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

        // Banner e status visual
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
});
