/**
 * FACE ACCESS - CALIBRAÇÃO AUTOMÁTICA DE LIMIAR BIOMÉTRICO
 * 
 * Coleta amostras genuínas ("sou eu") e impostoras ("outra pessoa"),
 * calcula P95 genuíno, P5 impostor, ponto médio (limiar ótimo),
 * e exibe as taxas de Falso Aceite (FAR) e Falso Negado (FRR).
 */

document.addEventListener('DOMContentLoaded', async () => {
    const video = document.getElementById('webcam');
    const canvasOverlay = document.getElementById('canvas-overlay');
    const ctx = canvasOverlay.getContext('2d');
    const ovalGuide = document.getElementById('oval-guide');
    const pillStatus = document.getElementById('pill-status');
    const pillText = document.getElementById('pill-text');

    const btnCollectGen = document.getElementById('btn-collect-genuine');
    const btnCollectImp = document.getElementById('btn-collect-impostor');
    const btnSimulateImp = document.getElementById('btn-simulate-impostor');
    const btnSaveCalibration = document.getElementById('btn-save-calibration');

    const countGenEl = document.getElementById('count-genuine');
    const countImpEl = document.getElementById('count-impostor');

    // Resultados
    const valP95 = document.getElementById('val-p95');
    const valP5 = document.getElementById('val-p5');
    const valLimiar = document.getElementById('val-limiar-calib');
    const valFar = document.getElementById('val-far');
    const valFrr = document.getElementById('val-frr');

    const distCompareBar = document.getElementById('dist-compare-bar');
    const thresholdLine = document.getElementById('threshold-line');
    const thresholdLabel = document.getElementById('threshold-label');

    let currentFace = null;
    let genuineCaptures = [];
    let impostorCaptures = [];
    let genuineDistances = [];
    let impostorDistances = [];
    let calibrationResult = null;

    // 1. Carrega calibração pré-existente
    try {
        const res = await fetch('/api/calibracao');
        const data = await res.json();
        if (data.calibrado && data.dados) {
            exibirMetricas(data.dados);
        }
    } catch (e) {
        console.warn('Erro ao carregar calibração anterior:', e);
    }

    // 2. Inicializa Câmera
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
    }

    // 3. MediaPipe FaceMesh
    if (typeof FaceMesh !== 'undefined') {
        const faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.6
        });

        faceMesh.onResults((results) => {
            ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
            const faces = results.multiFaceLandmarks;

            if (!faces || faces.length === 0) {
                currentFace = null;
                return;
            }

            currentFace = faces[0];
            ovalGuide.className = 'oval-guide tracking';

            // Desenha apenas os 90 pontos estáveis em violeta/neon
            ctx.fillStyle = '#8B5CF6';
            for (const idx of FaceLandmarks.STABLE_LANDMARK_INDICES) {
                const pt = currentFace[idx];
                if (pt) {
                    ctx.beginPath();
                    ctx.arc(pt.x * canvasOverlay.width, pt.y * canvasOverlay.height, 2.2, 0, 2 * Math.PI);
                    ctx.fill();
                }
            }
        });

        async function processFrame() {
            if (video.readyState >= 2 && !video.paused) {
                try { await faceMesh.send({ image: video }); } catch (e) {}
            }
            requestAnimationFrame(processFrame);
        }
        processFrame();
    }

    // 4. Coleta Amostras Genuínas ("Sou Eu")
    btnCollectGen.addEventListener('click', async () => {
        if (!currentFace) {
            alert('Posicione o rosto na câmera para iniciar a coleta genuína.');
            return;
        }

        btnCollectGen.disabled = true;
        genuineCaptures = [];
        const total = 30;

        for (let i = 0; i < total; i++) {
            pillStatus.className = 'pill-status active';
            pillText.textContent = `Coletando "Sou Eu": ${i + 1}/${total} (movimente levemente a cabeça)`;

            await new Promise(r => setTimeout(r, 120));

            if (currentFace) {
                const stablePts = FaceLandmarks.extractStableLandmarks(currentFace);
                const normPts = FaceLandmarks.normalizeLandmarks(stablePts);
                genuineCaptures.push(normPts);
                countGenEl.textContent = `${genuineCaptures.length} amostras`;
            }
        }

        pillStatus.className = 'pill-status success';
        pillText.textContent = 'Amostras genuínas concluídas!';
        btnCollectGen.disabled = false;

        verificarEExecutarCalibracao();
    });

    // 5. Coleta Amostras Impostoras ("Outra Pessoa")
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
        pillText.textContent = 'Amostras impostoras concluídas!';
        btnCollectImp.disabled = false;

        verificarEExecutarCalibracao();
    });

    // 6. Simulação Sintética de Impostores (caso o usuário esteja sozinho na máquina)
    if (btnSimulateImp) {
        btnSimulateImp.addEventListener('click', () => {
            if (genuineCaptures.length === 0) {
                alert('Colete primeiro as amostras genuínas ("Sou Eu") para podermos simular impostores matemáticos de referência.');
                return;
            }

            impostorCaptures = [];
            const meanGen = FaceLandmarks.computeMeanLandmarks(genuineCaptures);

            // Gera 35 impostores sintéticos variando proporções cranianas (mandíbula, olhos, nariz)
            for (let k = 0; k < 35; k++) {
                const scaleW = 0.75 + 0.5 * Math.sin(k * 1.3);
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

    // 7. Executa cálculo da calibração
    function verificarEExecutarCalibracao() {
        if (genuineCaptures.length < 10 || impostorCaptures.length < 10) {
            return;
        }

        // Calcula a média das capturas genuínas
        const meanGenuine = FaceLandmarks.computeMeanLandmarks(genuineCaptures);

        // Calcula distâncias intra-classe (genuínas)
        genuineDistances = genuineCaptures.map(c => FaceLandmarks.calculateDistance(c, meanGenuine));

        // Calcula distâncias inter-classe (impostoras em relação à média genuína)
        impostorDistances = impostorCaptures.map(c => FaceLandmarks.calculateDistance(c, meanGenuine));

        calibrationResult = FaceLandmarks.calculateCalibration(genuineDistances, impostorDistances);
        exibirMetricas(calibrationResult);

        if (btnSaveCalibration) btnSaveCalibration.disabled = false;
    }

    // 8. Exibe métricas e atualiza o gráfico
    function exibirMetricas(res) {
        if (valP95) valP95.textContent = res.p95Genuino !== null ? res.p95Genuino.toFixed(4) : '--';
        if (valP5) valP5.textContent = res.p5Impostor !== null ? res.p5Impostor.toFixed(4) : '--';
        if (valLimiar) valLimiar.textContent = res.limiar !== null ? res.limiar.toFixed(4) : '--';
        if (valFar) valFar.textContent = `${res.far}%`;
        if (valFrr) valFrr.textContent = `${res.frr}%`;

        // Posiciona a linha do limiar na barra de comparação
        // Escala normalizada de 0.00 a 0.15
        const maxScale = 0.15;
        const pctThreshold = Math.min(100, Math.max(0, (res.limiar / maxScale) * 100));

        if (thresholdLine) {
            thresholdLine.style.left = `${pctThreshold}%`;
        }
        if (thresholdLabel) {
            thresholdLabel.style.left = `${pctThreshold}%`;
            thresholdLabel.textContent = `Limiar: ${res.limiar.toFixed(4)}`;
        }
    }

    // 9. Salva calibração no servidor
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
                    alert(`✅ Limiar de ${calibrationResult.limiar} ativado e salvo com sucesso em data/calibracao.json!`);
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
});
