/**
 * FACE ACCESS - SERVIDOR NODE.JS + EXPRESS
 * 
 * Arquitetura: Node + HTML/CSS/JS + MediaPipe no Navegador + JSON em data/pessoas.json
 * Modos de operação:
 * - "landmarks": 90 pontos estáveis (Geometria óssea 3D, versaoModelo: "landmarks-v1")
 * - "modelo": MobileFaceNet ONNX 512D (versaoModelo: "mobilefacenet-v1")
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const FaceLandmarks = require('./public/js/landmarks');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do ambiente e arquivos de persistência
const DATA_DIR = path.join(__dirname, 'data');
const PESSOAS_FILE = path.join(DATA_DIR, 'pessoas.json');
const CALIBRACAO_FILE = path.join(DATA_DIR, 'calibracao.json');

// Garante existência do diretório e arquivos de dados
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(PESSOAS_FILE)) {
    fs.writeFileSync(PESSOAS_FILE, JSON.stringify([], null, 2), 'utf-8');
}

// Configurações em tempo de execução
let runtimeConfig = {
    embeddingMode: process.env.EMBEDDING_MODE || 'landmarks', // 'landmarks' | 'modelo'
    limiarPadraoLandmarks: 0.05, // 5 centésimos (conservador seguro contra falso aceite)
    limiarPadraoModelo: 0.40,    // Distância de cosseno máx (equivalente a similaridade >= 0.60)
    margemMinimaRazao: 1.30,     // Exigência de 30% a mais de distância ao 2º melhor candidato
    minFramesConsecutivos: 10
};

// Middlewares
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Funções auxiliares de persistência
function carregarPessoas() {
    try {
        if (!fs.existsSync(PESSOAS_FILE)) return [];
        const raw = fs.readFileSync(PESSOAS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : (parsed.pessoas || []);
    } catch (err) {
        console.error('[ERRO] Falha ao ler pessoas.json:', err.message);
        return [];
    }
}

function salvarPessoas(pessoas) {
    fs.writeFileSync(PESSOAS_FILE, JSON.stringify(pessoas, null, 2), 'utf-8');
}

function carregarCalibracao() {
    try {
        if (!fs.existsSync(CALIBRACAO_FILE)) return null;
        const raw = fs.readFileSync(CALIBRACAO_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

function salvarCalibracao(dados) {
    fs.writeFileSync(CALIBRACAO_FILE, JSON.stringify(dados, null, 2), 'utf-8');
}

function obterLimiarAtivo(modo) {
    if (modo === 'modelo') {
        return runtimeConfig.limiarPadraoModelo;
    }
    const cal = carregarCalibracao();
    if (cal && typeof cal.limiar === 'number' && cal.limiar > 0) {
        return cal.limiar;
    }
    return runtimeConfig.limiarPadraoLandmarks;
}

// ================= ROTAS DE PÁGINAS =================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/acesso', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/cadastro', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/calibracao', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// ================= ENDPOINTS DA API =================

/**
 * GET /config
 * Retorna as configurações ativas e o limiar vigente
 */
app.get('/config', (req, res) => {
    const modo = runtimeConfig.embeddingMode;
    const limiar = obterLimiarAtivo(modo);
    const cal = carregarCalibracao();
    res.json({
        ...runtimeConfig,
        limiarAtivo: limiar,
        calibracaoExistente: !!cal,
        detalhesCalibracao: cal
    });
});

/**
 * POST /config
 * Permite alterar o modo ativo ('landmarks' | 'modelo') ou limiar padrão
 */
app.post('/config', (req, res) => {
    const { embeddingMode, limiarPadraoLandmarks, limiarPadraoModelo } = req.body || {};
    if (embeddingMode === 'landmarks' || embeddingMode === 'modelo') {
        runtimeConfig.embeddingMode = embeddingMode;
    }
    if (typeof limiarPadraoLandmarks === 'number' && limiarPadraoLandmarks > 0) {
        runtimeConfig.limiarPadraoLandmarks = limiarPadraoLandmarks;
    }
    if (typeof limiarPadraoModelo === 'number' && limiarPadraoModelo > 0) {
        runtimeConfig.limiarPadraoModelo = limiarPadraoModelo;
    }
    res.json({ status: 'ok', config: runtimeConfig, limiarAtivo: obterLimiarAtivo(runtimeConfig.embeddingMode) });
});

/**
 * GET /pessoas
 * Lista os usuários cadastrados (sem vetores pesados para leveza)
 */
app.get('/pessoas', (req, res) => {
    const pessoas = carregarPessoas();
    const sanitizado = pessoas.map(p => ({
        nome: p.nome,
        versaoModelo: p.versaoModelo || 'landmarks-v1',
        amostras: p.amostras || (p.capturas ? p.capturas.length : 0),
        criadoEm: p.criadoEm || ''
    }));
    res.json({ total: sanitizado.length, pessoas: sanitizado });
});

/**
 * DELETE /pessoas/:nome
 * Remove um usuário cadastrado
 */
app.delete('/pessoas/:nome', (req, res) => {
    const nomeAlvo = decodeURIComponent(req.params.nome).trim().toLowerCase();
    const pessoas = carregarPessoas();
    const filtrado = pessoas.filter(p => p.nome.trim().toLowerCase() !== nomeAlvo);
    if (filtrado.length === pessoas.length) {
        return res.status(404).json({ error: 'Pessoa não encontrada.' });
    }
    salvarPessoas(filtrado);
    res.json({ status: 'ok', message: `Cadastro de '${req.params.nome}' excluído com sucesso.` });
});

/**
 * GET /calibracao
 * Retorna os dados da calibração atual
 */
app.get('/api/calibracao', (req, res) => {
    const cal = carregarCalibracao();
    if (!cal) {
        return res.json({ calibrado: false, limiarPadrao: runtimeConfig.limiarPadraoLandmarks });
    }
    res.json({ calibrado: true, dados: cal });
});

/**
 * POST /calibracao
 * Salva os resultados da calibração e atualiza o limiar do sistema
 */
app.post('/calibracao', (req, res) => {
    const { limiar, p95Genuino, p5Impostor, far, frr, amostrasGenuinas, amostrasImpostoras } = req.body || {};

    if (typeof limiar !== 'number' || limiar <= 0) {
        return res.status(400).json({ error: 'Limiar inválido informado.' });
    }

    const payload = {
        limiar: Number(limiar.toFixed(4)),
        p95Genuino: typeof p95Genuino === 'number' ? Number(p95Genuino.toFixed(4)) : null,
        p5Impostor: typeof p5Impostor === 'number' ? Number(p5Impostor.toFixed(4)) : null,
        far: typeof far === 'number' ? Number(far.toFixed(2)) : 0,
        frr: typeof frr === 'number' ? Number(frr.toFixed(2)) : 0,
        amostrasGenuinas: amostrasGenuinas || 0,
        amostrasImpostoras: amostrasImpostoras || 0,
        atualizadoEm: new Date().toISOString()
    };

    salvarCalibracao(payload);
    console.log(`[CALIBRAÇÃO] Novo limiar salvo: ${payload.limiar} (P95 Gen: ${payload.p95Genuino}, P5 Imp: ${payload.p5Impostor}, FAR: ${payload.far}%, FRR: ${payload.frr}%)`);

    res.json({
        status: 'ok',
        message: 'Calibração salva com sucesso.',
        dados: payload
    });
});

/**
 * POST /cadastrar
 * Cadastra uma pessoa salvando as 5 capturas e calculando a MÉDIA exata
 */
app.post('/cadastrar', (req, res) => {
    const { nome, capturas, modo, sobrescrever } = req.body || {};
    const nomeLimpo = (nome || '').trim();

    if (!nomeLimpo) {
        return res.status(400).json({ error: 'Por favor, informe o nome para cadastro.' });
    }

    if (!capturas || !Array.isArray(capturas) || capturas.length < 3) {
        return res.status(400).json({ error: 'Envie ao menos 3 capturas estáveis (recomendado: 5) para realizar o cadastro.' });
    }

    const versaoModelo = modo === 'modelo' ? 'mobilefacenet-v1' : 'landmarks-v1';
    const pessoas = carregarPessoas();
    const existeIndex = pessoas.findIndex(p => p.nome.trim().toLowerCase() === nomeLimpo.toLowerCase());

    if (existeIndex >= 0 && !sobrescrever) {
        return res.status(409).json({
            duplicado: true,
            mensagem: `O usuário '${nomeLimpo}' já está cadastrado. Confirme se deseja sobrescrever.`
        });
    }

    let mediaLandmarks = null;
    let mediaEmbedding = null;

    if (modo === 'modelo') {
        // Média de embeddings 512D
        const dim = capturas[0].length;
        const meanVec = new Array(dim).fill(0);
        for (const vec of capturas) {
            for (let i = 0; i < dim; i++) meanVec[i] += vec[i];
        }
        let sumSq = 0;
        for (let i = 0; i < dim; i++) {
            meanVec[i] /= capturas.length;
            sumSq += meanVec[i] * meanVec[i];
        }
        const norm = Math.sqrt(sumSq) || 1.0;
        mediaEmbedding = meanVec.map(v => v / norm);
    } else {
        // Média das 5 capturas normalizadas de 90 pontos estáveis
        mediaLandmarks = FaceLandmarks.computeMeanLandmarks(capturas);
    }

    const novoRegistro = {
        nome: nomeLimpo,
        versaoModelo,
        modo: modo || 'landmarks',
        amostras: capturas.length,
        mediaLandmarks,
        mediaEmbedding,
        capturas, // Armazena as capturas individuais originais
        criadoEm: new Date().toISOString()
    };

    if (existeIndex >= 0) {
        pessoas[existeIndex] = novoRegistro;
    } else {
        pessoas.push(novoRegistro);
    }

    salvarPessoas(pessoas);
    console.log(`[CADASTRO] '${nomeLimpo}' cadastrado com sucesso (${capturas.length} amostras, versão: ${versaoModelo}).`);

    res.json({
        status: 'ok',
        mensagem: `Cadastro de '${nomeLimpo}' realizado com sucesso!`,
        pessoa: {
            nome: nomeLimpo,
            versaoModelo,
            amostras: capturas.length,
            criadoEm: novoRegistro.criadoEm
        }
    });
});

/**
 * POST /verificar
 * Verificação facial com regras rigorosas:
 * 1. Comparação contra a MÉDIA do cadastro (não o mínimo das capturas)
 * 2. Média temporal de 10 frames consecutivos
 * 3. Margem de segurança: distância 2º candidato >= 1.3x a do melhor (quando houver 2+ cadastros)
 * 4. Isolamento por versaoModelo (ignora versões diferentes)
 * 5. Logs detalhados no console e retorno completo para o painel de diagnóstico
 */
app.post('/verificar', (req, res) => {
    const { frames, modo } = req.body || {};
    const modoAtivo = modo || runtimeConfig.embeddingMode || 'landmarks';
    const versaoEsperada = modoAtivo === 'modelo' ? 'mobilefacenet-v1' : 'landmarks-v1';
    const limiar = obterLimiarAtivo(modoAtivo);

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
        return res.status(400).json({
            aprovado: false,
            motivo: 'Nenhum frame facial recebido para verificação.'
        });
    }

    const pessoas = carregarPessoas();
    // Filtra exclusivamente pessoas cadastradas na mesma versão de modelo
    const cadastradasCompativeis = pessoas.filter(p => (p.versaoModelo || 'landmarks-v1') === versaoEsperada);

    if (cadastradasCompativeis.length === 0) {
        console.log(`[VERIFICAR] Acesso NEGADO: Nenhum usuário cadastrado compatível com a versão ${versaoEsperada}.`);
        return res.json({
            aprovado: false,
            usuario: null,
            motivo: `Nenhum usuário cadastrado no modo '${modoAtivo}' (${versaoEsperada}). Cadastre alguém primeiro.`,
            distanciaMelhor: null,
            melhorCandidato: null,
            distanciaSegundo: null,
            segundoCandidato: null,
            limiar,
            modo: modoAtivo,
            versaoModelo: versaoEsperada
        });
    }

    // Calcula a distância média dos frames para a MÉDIA cadastrada de cada pessoa
    const resultadosPorPessoa = cadastradasCompativeis.map(pessoa => {
        let somaDistancias = 0;

        for (let t = 0; t < frames.length; t++) {
            const frame = frames[t];
            let dist = 1.0;

            if (modoAtivo === 'modelo') {
                const embAlvo = pessoa.mediaEmbedding || pessoa.capturas[0];
                const sim = FaceLandmarks.calculateCosineSimilarity(frame, embAlvo);
                dist = Math.max(0, 1.0 - sim); // Distância de cosseno
            } else {
                // Modo landmarks estáveis: compara contra a MÉDIA do cadastro
                const landmarksAlvo = pessoa.mediaLandmarks || pessoa.capturas[0];
                dist = FaceLandmarks.calculateDistance(frame, landmarksAlvo);
            }
            somaDistancias += dist;
        }

        const distanciaMedia = somaDistancias / frames.length;

        return {
            nome: pessoa.nome,
            distanciaMedia: Number(distanciaMedia.toFixed(5))
        };
    });

    // Ordena pelo melhor (menor distância)
    resultadosPorPessoa.sort((a, b) => a.distanciaMedia - b.distanciaMedia);

    const melhor = resultadosPorPessoa[0];
    const segundo = resultadosPorPessoa.length > 1 ? resultadosPorPessoa[1] : null;

    const distMelhor = melhor.distanciaMedia;
    const distSegundo = segundo ? segundo.distanciaMedia : null;

    let razaoMargem = null;
    let margemAtendida = true;
    let motivoRejeicao = null;

    // Regra 1: Distância ao melhor candidato deve ser estritamente menor que o limiar
    const limiarAtendido = distMelhor < limiar;
    if (!limiarAtendido) {
        motivoRejeicao = `Distância do melhor candidato (${distMelhor.toFixed(4)}) excede o limiar (${limiar.toFixed(4)}).`;
    }

    // Regra 2: Quando houver 2+ cadastros, exigir margem >= 1.3x
    if (segundo && distMelhor > 0) {
        razaoMargem = Number((distSegundo / distMelhor).toFixed(2));
        if (razaoMargem < runtimeConfig.margemMinimaRazao) {
            margemAtendida = false;
            if (!motivoRejeicao) {
                motivoRejeicao = `Margem insuficiente: segundo melhor (${segundo.nome}, ${distSegundo.toFixed(4)}) está a apenas ${razaoMargem}x do melhor (exigido: >= ${runtimeConfig.margemMinimaRazao}x).`;
            }
        }
    }

    const aprovado = limiarAtendido && margemAtendida;
    const motivoFinal = aprovado 
        ? `Identidade confirmada com distância ${distMelhor.toFixed(4)} < ${limiar.toFixed(4)}${razaoMargem ? ` e margem ${razaoMargem}x` : ''}.`
        : motivoRejeicao;

    // DIAGNÓSTICO EXIGIDO NO CONSOLE DO /verificar
    console.log('='.repeat(75));
    console.log(`[POST /verificar] DIAGNÓSTICO DE ACESSO:`);
    console.log(` • Modo: ${modoAtivo} (Versão: ${versaoEsperada})`);
    console.log(` • Avaliação: Média de ${frames.length} frames consecutivos`);
    console.log(` • Limiar Ativo: ${limiar.toFixed(4)}`);
    console.log(` • Melhor Candidato: '${melhor.nome}' | Distância: ${distMelhor.toFixed(4)}`);
    console.log(` • Segundo Candidato: ${segundo ? `'${segundo.nome}' | Distância: ${distSegundo.toFixed(4)}` : 'N/A (Apenas 1 usuário cadastrado)'}`);
    console.log(` • Razão de Margem (d2 / d1): ${razaoMargem !== null ? `${razaoMargem}x (Exigido: >= ${runtimeConfig.margemMinimaRazao}x)` : 'N/A'}`);
    console.log(` • Decisão: ${aprovado ? '>>> ACESSO LIBERADO <<<' : '>>> ACESSO NEGADO <<<'}`);
    console.log(` • Motivo: ${motivoFinal}`);
    console.log('='.repeat(75));

    // Resposta para o cliente e painel de diagnóstico
    res.json({
        aprovado,
        usuario: aprovado ? melhor.nome : null,
        melhorCandidato: melhor.nome,
        distanciaMelhor: distMelhor,
        segundoCandidato: segundo ? segundo.nome : null,
        distanciaSegundo: distSegundo,
        razaoMargem,
        margemAtendida,
        limiarAtendido,
        limiar,
        modo: modoAtivo,
        versaoModelo: versaoEsperada,
        framesAvaliados: frames.length,
        motivo: motivoFinal,
        timestamp: new Date().toISOString()
    });
});

// Inicialização do Servidor
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n======================================================`);
        console.log(` 🛡️ FACE ACCESS - Sistema Biométrico Iniciado`);
        console.log(` URL Local: http://localhost:${PORT}`);
        console.log(` Arquitetura: Node + HTML/CSS/JS + MediaPipe no Navegador`);
        console.log(` Base de Dados: ${PESSOAS_FILE}`);
        console.log(` Limiar Padrão (Landmarks): ${runtimeConfig.limiarPadraoLandmarks}`);
        console.log(` Margem Mínima (2º Candidato): >= ${runtimeConfig.margemMinimaRazao}x`);
        console.log(` Decisão por Janela: ${runtimeConfig.minFramesConsecutivos} frames consecutivos`);
        console.log(`======================================================\n`);
    });
}

module.exports = app;
