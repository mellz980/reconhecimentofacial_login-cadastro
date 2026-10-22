/**
 * LANDMARKS FACIAIS ESTÁVEIS & FUNÇÕES MATEMÁTICAS BIOMÉTRICAS
 * 
 * Este módulo isola estritamente os pontos rígidos da estrutura óssea facial:
 * - Contorno do rosto (Face Oval)
 * - Olhos (canto e borda orbital rígida)
 * - Ponte nasal e Nariz (dorso, ápice e asas)
 * 
 * EXCLUI COMPLETAMENTE:
 * - Boca e lábios (alta deformação por fala, sorriso e abertura)
 * - Sobrancelhas (alta variação por expressões faciais)
 * 
 * Funciona de forma isomórfica (Navegador e Node.js).
 */

(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        root.FaceLandmarks = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // 1. Contorno externo e linha da mandíbula / face oval (36 pontos)
    const FACE_OVAL_INDICES = [
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
        400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
        54, 103, 67, 109
    ];

    // 2. Olho Esquerdo - borda óssea orbital rígida (16 pontos)
    const LEFT_EYE_INDICES = [
        33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246
    ];

    // 3. Olho Direito - borda óssea orbital rígida (16 pontos)
    const RIGHT_EYE_INDICES = [
        362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398
    ];

    // 4. Ponte Nasal (Glabela até dorso rígido) (5 pontos)
    const NOSE_BRIDGE_INDICES = [
        168, 6, 197, 195, 5
    ];

    // 5. Nariz - Dorso, ponta e asas nasais (17 pontos)
    const NOSE_INDICES = [
        4, 1, 19, 94, 2, 98, 97, 327, 326, 278, 48, 218, 438, 220, 440, 242, 462
    ];

    // União de todos os pontos anatômicos estáveis (ordenados e deduplicados)
    const STABLE_LANDMARK_INDICES = Array.from(
        new Set([
            ...FACE_OVAL_INDICES,
            ...LEFT_EYE_INDICES,
            ...RIGHT_EYE_INDICES,
            ...NOSE_BRIDGE_INDICES,
            ...NOSE_INDICES
        ])
    ).sort((a, b) => a - b);

    // Mapeamento de índices estáveis para busca rápida de olhos no vetor extraído
    const leftEyeMap = LEFT_EYE_INDICES.map(idx => STABLE_LANDMARK_INDICES.indexOf(idx)).filter(i => i >= 0);
    const rightEyeMap = RIGHT_EYE_INDICES.map(idx => STABLE_LANDMARK_INDICES.indexOf(idx)).filter(i => i >= 0);

    /**
     * Extrai apenas os pontos estáveis de um conjunto completo de 468 pontos do MediaPipe FaceMesh.
     */
    function extractStableLandmarks(allLandmarks) {
        if (!allLandmarks || !Array.isArray(allLandmarks)) {
            throw new Error('Conjunto de landmarks inválido fornecido para extração.');
        }

        const stable = [];
        for (let i = 0; i < STABLE_LANDMARK_INDICES.length; i++) {
            const idx = STABLE_LANDMARK_INDICES[i];
            const pt = allLandmarks[idx];
            if (!pt) {
                throw new Error(`Ponto de landmark no índice ${idx} ausente.`);
            }
            stable.push({
                x: Number(pt.x),
                y: Number(pt.y),
                z: pt.z !== undefined ? Number(pt.z) : 0.0
            });
        }
        return stable;
    }

    /**
     * Normaliza os pontos faciais:
     * 1. Translada o centroide para a origem (0, 0, 0)
     * 2. Alinha a rotação 2D (roll) nivelando o eixo inter-ocular horizontalmente
     * 3. Escala pelo desvio médio quadrático (RMS) para invariância estrita de escala.
     */
    function normalizeLandmarks(points) {
        if (!points || points.length === 0) return [];
        const n = points.length;

        // 1. Centroide
        let sumX = 0, sumY = 0, sumZ = 0;
        for (let i = 0; i < n; i++) {
            sumX += points[i].x;
            sumY += points[i].y;
            sumZ += points[i].z;
        }

        const meanX = sumX / n;
        const meanY = sumY / n;
        const meanZ = sumZ / n;

        const centered = new Array(n);
        for (let i = 0; i < n; i++) {
            centered[i] = {
                x: points[i].x - meanX,
                y: points[i].y - meanY,
                z: points[i].z - meanZ
            };
        }

        // 2. Alinhamento de rotação inter-ocular (roll)
        let rotated = centered;
        if (leftEyeMap.length > 0 && rightEyeMap.length > 0) {
            let lx = 0, ly = 0;
            for (let i = 0; i < leftEyeMap.length; i++) {
                const pt = centered[leftEyeMap[i]];
                if (pt) { lx += pt.x; ly += pt.y; }
            }
            lx /= leftEyeMap.length;
            ly /= leftEyeMap.length;

            let rx = 0, ry = 0;
            for (let i = 0; i < rightEyeMap.length; i++) {
                const pt = centered[rightEyeMap[i]];
                if (pt) { rx += pt.x; ry += pt.y; }
            }
            rx /= rightEyeMap.length;
            ry /= rightEyeMap.length;

            const angle = Math.atan2(ry - ly, rx - lx);
            const cosA = Math.cos(-angle);
            const sinA = Math.sin(-angle);

            rotated = new Array(n);
            for (let i = 0; i < n; i++) {
                const p = centered[i];
                rotated[i] = {
                    x: p.x * cosA - p.y * sinA,
                    y: p.x * sinA + p.y * cosA,
                    z: p.z
                };
            }
        }

        // 3. Fator de escala RMS (Procrustes)
        let sumSqDist = 0;
        for (let i = 0; i < n; i++) {
            sumSqDist += (rotated[i].x * rotated[i].x + rotated[i].y * rotated[i].y + rotated[i].z * rotated[i].z);
        }
        const scale = Math.sqrt(sumSqDist / n) || 1.0;

        const normalized = new Array(n);
        for (let i = 0; i < n; i++) {
            normalized[i] = {
                x: rotated[i].x / scale,
                y: rotated[i].y / scale,
                z: rotated[i].z / scale
            };
        }

        return normalized;
    }

    /**
     * Calcula a média elemento a elemento de múltiplas capturas normalizadas (ex.: 5 capturas do cadastro).
     */
    function computeMeanLandmarks(landmarkSets) {
        if (!landmarkSets || landmarkSets.length === 0) {
            throw new Error('Nenhum conjunto de capturas fornecido para cálculo da média.');
        }

        const numSets = landmarkSets.length;
        const numPoints = landmarkSets[0].length;
        const meanPoints = [];

        for (let p = 0; p < numPoints; p++) {
            let sumX = 0, sumY = 0, sumZ = 0;
            for (let s = 0; s < numSets; s++) {
                sumX += landmarkSets[s][p].x;
                sumY += landmarkSets[s][p].y;
                sumZ += landmarkSets[s][p].z;
            }
            meanPoints.push({
                x: sumX / numSets,
                y: sumY / numSets,
                z: sumZ / numSets
            });
        }

        return normalizeLandmarks(meanPoints);
    }

    /**
     * Calcula a distância média euclidiana por ponto entre dois conjuntos normalizados.
     * Escala típica:
     * - Mesmo rosto com pequenas variações: 0.015 a 0.035
     * - Rostos de pessoas diferentes: 0.065 a 0.160+
     * - Limiar conservador recomendado: 0.050 (5 centésimos)
     */
    function calculateDistance(pointsA, pointsB) {
        if (!pointsA || !pointsB || pointsA.length !== pointsB.length) {
            throw new Error('Conjuntos de pontos incompatíveis para cálculo de distância.');
        }

        const n = pointsA.length;
        let totalDist = 0;

        for (let i = 0; i < n; i++) {
            const dx = pointsA[i].x - pointsB[i].x;
            const dy = pointsA[i].y - pointsB[i].y;
            const dz = pointsA[i].z - pointsB[i].z;
            totalDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        return totalDist / n;
    }

    /**
     * Calcula a similaridade de cosseno entre dois vetores numéricos de mesma dimensão.
     */
    function calculateCosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Calcula o percentil (0 a 100) de uma lista de números.
     */
    function calculatePercentile(values, p) {
        if (!values || values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        if (p <= 0) return sorted[0];
        if (p >= 100) return sorted[sorted.length - 1];

        const index = (p / 100) * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const weight = index - lower;

        if (lower === upper) return sorted[lower];
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    }

    /**
     * Calibração automática do limiar biométrico entre genuínos e impostores.
     */
    function calculateCalibration(genuineDistances, impostorDistances) {
        if (!genuineDistances || genuineDistances.length === 0 ||
            !impostorDistances || impostorDistances.length === 0) {
            throw new Error('Amostras genuínas e impostoras são obrigatórias para calibração.');
        }

        // P95 das distâncias genuínas
        const p95Genuino = calculatePercentile(genuineDistances, 95);

        // P5 das distâncias impostoras
        const p5Impostor = calculatePercentile(impostorDistances, 5);

        // Ponto médio entre P95 genuíno e P5 impostor
        let limiar = (p95Genuino + p5Impostor) / 2;

        if (limiar <= 0) limiar = 0.05;

        // FAR e FRR
        const falsosAceites = impostorDistances.filter(d => d < limiar).length;
        const far = (falsosAceites / impostorDistances.length) * 100;

        const falsosNegados = genuineDistances.filter(d => d >= limiar).length;
        const frr = (falsosNegados / genuineDistances.length) * 100;

        return {
            limiar: Number(limiar.toFixed(4)),
            p95Genuino: Number(p95Genuino.toFixed(4)),
            p5Impostor: Number(p5Impostor.toFixed(4)),
            far: Number(far.toFixed(2)),
            frr: Number(frr.toFixed(2)),
            amostrasGenuinas: genuineDistances.length,
            amostrasImpostoras: impostorDistances.length
        };
    }

    return {
        FACE_OVAL_INDICES,
        LEFT_EYE_INDICES,
        RIGHT_EYE_INDICES,
        NOSE_BRIDGE_INDICES,
        NOSE_INDICES,
        STABLE_LANDMARK_INDICES,
        extractStableLandmarks,
        normalizeLandmarks,
        computeMeanLandmarks,
        calculateDistance,
        calculateCosineSimilarity,
        calculatePercentile,
        calculateCalibration
    };
}));
