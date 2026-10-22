/**
 * ONNX RUNTIME WEB - ENGINE DE EMBEDDING FACIAL (512D)
 * Alinha o rosto pelos olhos e gera vetor de características via MobileFaceNet ONNX.
 */

(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else {
        root.OnnxFaceEngine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    let session = null;
    let isInitializing = false;
    let modelLoaded = false;
    const MODEL_PATH = '/models/mobilefacenet.onnx';

    const canvas112 = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (canvas112) {
        canvas112.width = 112;
        canvas112.height = 112;
    }

    /**
     * Inicializa a sessão do ONNX Runtime Web
     */
    async function init() {
        if (modelLoaded && session) return session;
        if (isInitializing) {
            while (isInitializing) {
                await new Promise(r => setTimeout(r, 50));
            }
            return session;
        }

        isInitializing = true;
        try {
            if (typeof ort === 'undefined') {
                console.warn('[ONNX] onnxruntime-web (ort) ainda não foi carregado via CDN.');
                return null;
            }

            console.log('[ONNX] Carregando modelo MobileFaceNet de:', MODEL_PATH);
            // Configura opções para WebAssembly
            ort.env.wasm.numThreads = 1;
            session = await ort.InferenceSession.create(MODEL_PATH, {
                executionProviders: ['wasm']
            });
            modelLoaded = true;
            console.log('[ONNX] Modelo MobileFaceNet carregado com sucesso!');
            return session;
        } catch (err) {
            console.error('[ONNX] Erro ao carregar modelo ONNX:', err);
            return null;
        } finally {
            isInitializing = false;
        }
    }

    /**
     * Alinha o rosto usando os pontos dos olhos e recorta para um canvas 112x112.
     * leftEye e rightEye são coordenadas em pixels {x, y}.
     */
    function cropAndAlignFace(videoElement, leftEye, rightEye) {
        if (!canvas112) return null;
        const ctx = canvas112.getContext('2d');
        ctx.clearRect(0, 0, 112, 112);

        // Pontos de ancoragem padrão MobileFaceNet / ArcFace em 112x112
        const desiredLeftEye = { x: 38.0, y: 48.0 };
        const desiredRightEye = { x: 74.0, y: 48.0 };
        const desiredDist = desiredRightEye.x - desiredLeftEye.x; // 36 px

        // Geometria atual
        const dx = rightEye.x - leftEye.x;
        const dy = rightEye.y - leftEye.y;
        const currentDist = Math.sqrt(dx * dx + dy * dy);
        if (currentDist === 0) return null;

        const currentAngle = Math.atan2(dy, dx);
        const scale = desiredDist / currentDist;

        const eyeCenterCurrent = {
            x: (leftEye.x + rightEye.x) / 2,
            y: (leftEye.y + rightEye.y) / 2
        };

        const eyeCenterDesired = {
            x: (desiredLeftEye.x + desiredRightEye.x) / 2,
            y: desiredLeftEye.y
        };

        ctx.save();
        ctx.translate(eyeCenterDesired.x, eyeCenterDesired.y);
        ctx.rotate(-currentAngle);
        ctx.scale(scale, scale);
        ctx.translate(-eyeCenterCurrent.x, -eyeCenterCurrent.y);

        ctx.drawImage(videoElement, 0, 0);
        ctx.restore();

        return ctx.getImageData(0, 0, 112, 112);
    }

    /**
     * Converte ImageData (RGBA) para Float32Array planar [1, 3, 112, 112]
     * com normalização padrão (pixel - 127.5) / 128.0
     */
    function imageDataToTensorData(imgData) {
        const { width, height, data } = imgData;
        const numPixels = width * height;
        const floatData = new Float32Array(3 * numPixels);

        // Plano R, Plano G, Plano B
        for (let i = 0; i < numPixels; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];

            floatData[i] = (r - 127.5) / 128.0;               // R
            floatData[numPixels + i] = (g - 127.5) / 128.0;   // G
            floatData[2 * numPixels + i] = (b - 127.5) / 128.0; // B
        }

        return floatData;
    }

    /**
     * Extrai vetor de embedding de 512 dimensões para o rosto.
     */
    async function extractEmbedding(videoElement, allLandmarks) {
        if (!allLandmarks || allLandmarks.length < 468) return null;

        // Ponto 33 (olho esquerdo externo) e 133 (olho esquerdo interno) -> centro
        // Ponto 362 (olho direito interno) e 263 (olho direito externo) -> centro
        const vidW = videoElement.videoWidth || videoElement.width || 640;
        const vidH = videoElement.videoHeight || videoElement.height || 480;

        const leftEyePx = {
            x: ((allLandmarks[33].x + allLandmarks[133].x) / 2) * vidW,
            y: ((allLandmarks[33].y + allLandmarks[133].y) / 2) * vidH
        };

        const rightEyePx = {
            x: ((allLandmarks[362].x + allLandmarks[263].x) / 2) * vidW,
            y: ((allLandmarks[362].y + allLandmarks[263].y) / 2) * vidH
        };

        const alignedImg = cropAndAlignFace(videoElement, leftEyePx, rightEyePx);
        if (!alignedImg) return null;

        if (!session) {
            await init();
        }

        if (session && typeof ort !== 'undefined') {
            try {
                const tensorData = imageDataToTensorData(alignedImg);
                const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, 112, 112]);
                const results = await session.run({ input: inputTensor });
                const outputTensor = results.output || results[Object.keys(results)[0]];
                const emb = Array.from(outputTensor.data);

                // Normalização L2
                let sumSq = 0;
                for (let i = 0; i < emb.length; i++) sumSq += emb[i] * emb[i];
                const norm = Math.sqrt(sumSq) || 1.0;
                return emb.map(v => v / norm);
            } catch (err) {
                console.error('[ONNX] Falha na inferência:', err);
            }
        }

        return null;
    }

    return {
        init,
        isLoaded: () => modelLoaded,
        cropAndAlignFace,
        extractEmbedding
    };
}));
