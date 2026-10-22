/**
 * FACE ACCESS - CLIENTE DE CADASTRO FACIAL
 * 
 * Regras implementadas:
 * - Coleta de 5 capturas estáveis com rosto detectado
 * - Extração estrita dos 90 landmarks anatômicos estáveis
 * - Cálculo da MÉDIA do cadastro
 * - Tratamento de cadastro duplicado com confirmação amigável
 */

document.addEventListener('DOMContentLoaded', async () => {
    const video = document.getElementById('webcam');
    const canvasOverlay = document.getElementById('canvas-overlay');
    const ctx = canvasOverlay.getContext('2d');
    const ovalGuide = document.getElementById('oval-guide');
    const pillStatus = document.getElementById('pill-status');
    const pillText = document.getElementById('pill-text');

    const formRegister = document.getElementById('form-register');
    const inputNome = document.getElementById('input-name');
    const btnCadastrar = document.getElementById('btn-start-register');
    const selectModo = document.getElementById('select-modo');
    const instructionBox = document.getElementById('instruction-box');
    const instructionText = document.getElementById('instruction-text');
    const badgeSuccess = document.getElementById('badge-success');
    const registeredNameEl = document.getElementById('registered-name');

    // Modal de sobrescrita
    const modalOverwrite = document.getElementById('modal-overwrite');
    const btnConfirmOverwrite = document.getElementById('btn-confirm-overwrite');
    const btnCancelOverwrite = document.getElementById('btn-cancel-overwrite');
    const modalText = document.getElementById('modal-text');

    let currentMode = 'landmarks';
    let currentFace = null;
    let isCapturing = false;

    // 1. Carrega configuração inicial
    try {
        const res = await fetch('/config');
        const cfg = await res.json();
        currentMode = cfg.embeddingMode || 'landmarks';
        if (selectModo) selectModo.value = currentMode;
    } catch (e) {
        console.warn(e);
    }

    if (selectModo) {
        selectModo.addEventListener('change', (e) => {
            currentMode = e.target.value;
        });
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
                if (!isCapturing) {
                    pillStatus.className = 'pill-status';
                    pillText.textContent = 'Posicione o rosto';
                    ovalGuide.className = 'oval-guide';
                }
                return;
            }

            currentFace = faces[0];
            if (!isCapturing) {
                ovalGuide.className = 'oval-guide tracking';
                pillStatus.className = 'pill-status active';
                pillText.textContent = 'Rosto pronto para cadastro';
            }

            // Desenha apenas os 90 pontos estáveis
            ctx.fillStyle = '#10B981'; // Emerald neon
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

    // 4. Fluxo de Submissão do Formulário
    let pendingName = '';
    formRegister.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = inputNome.value.trim();
        if (!nome) return;

        if (!currentFace) {
            alert('Por favor, posicione seu rosto dentro da moldura da câmera antes de cadastrar.');
            return;
        }

        pendingName = nome;
        await iniciarCaptura(nome, false);
    });

    if (btnConfirmOverwrite) {
        btnConfirmOverwrite.addEventListener('click', async () => {
            modalOverwrite.style.display = 'none';
            if (pendingName) {
                await iniciarCaptura(pendingName, true);
            }
        });
    }

    if (btnCancelOverwrite) {
        btnCancelOverwrite.addEventListener('click', () => {
            modalOverwrite.style.display = 'none';
            btnCadastrar.disabled = false;
        });
    }

    // 5. Coleta sequencial de 5 capturas estáveis
    async function iniciarCaptura(nome, sobrescrever) {
        isCapturing = true;
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

            // Aguarda 400ms para estabilização do usuário
            await new Promise(r => setTimeout(r, 450));

            if (!currentFace) {
                instructionText.textContent = 'Mantenha o rosto na câmera para continuar!';
                i--; // Repete a captura se perdeu o rosto
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
                // Usuário duplicado -> Abre modal
                modalText.textContent = data.mensagem;
                modalOverwrite.style.display = 'flex';
                isCapturing = false;
                return;
            }

            if (res.ok && data.status === 'ok') {
                // Sucesso
                ovalGuide.className = 'oval-guide success';
                pillStatus.className = 'pill-status success';
                pillText.textContent = 'Cadastrado com sucesso!';

                formRegister.style.display = 'none';
                badgeSuccess.style.display = 'flex';
                if (registeredNameEl) registeredNameEl.textContent = nome;
            } else {
                alert(`Erro ao cadastrar: ${data.error || 'Falha desconhecida.'}`);
                btnCadastrar.disabled = false;
            }
        } catch (err) {
            alert(`Erro de comunicação com o servidor: ${err.message}`);
            btnCadastrar.disabled = false;
        } finally {
            isCapturing = false;
        }
    }
});
