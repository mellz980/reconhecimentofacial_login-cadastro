# 🛡️ Face Access - Sistema Biométrico Facial com Prevenção de Falso Aceite

Aplicação web completa para controle de acesso biométrico facial inteligente com **Node.js**, **MediaPipe FaceMesh no navegador**, calibração automática de limiar, regras rígidas de decisão e persistência em **`data/pessoas.json`**.

---

## 🏗️ Arquitetura do Sistema

O projeto mantém rigorosamente a arquitetura estipulada:
- **Backend:** Node.js com Express (`server.js`)
- **Frontend:** HTML5 semântico, Vanilla CSS moderno (Dark Mode com Glassmorphism e micro-animações) e JavaScript puro (`/public`)
- **Visão Computacional no Navegador:** MediaPipe FaceMesh (468 landmarks faciais em tempo real via WebGL/Canvas)
- **Motor Opcional ONNX:** MobileFaceNet 512D executado localmente no cliente via `onnxruntime-web`
- **Armazenamento:** Arquivo JSON em `data/pessoas.json` e calibração em `data/calibracao.json`

```text
reconhecimentofacial_login-cadastro/
├── data/
│   ├── pessoas.json            # Base de dados biométrica dos usuários cadastrados
│   └── calibracao.json         # Parâmetros e percentis da calibração automática
├── public/
│   ├── css/
│   │   └── style.css           # Design System escuro com glassmorphism
│   ├── js/
│   │   ├── landmarks.js        # 90 pontos estáveis, normalização e métrica de distância
│   │   ├── onnx_engine.js      # Alinhamento pelos olhos e inferência MobileFaceNet ONNX
│   │   ├── script_acesso.js    # Lógica de acesso, buffer de 10 frames e diagnóstico
│   │   ├── script_cadastro.js  # Coleta de 5 capturas e consolidação pela média
│   │   └── script_calibracao.js# Calibração estatística (P95, P5, FAR e FRR)
│   ├── models/
│   │   └── mobilefacenet.onnx  # Modelo ONNX 512D para modo treinado
│   ├── index.html              # Terminal de Acesso Facial com painel de diagnóstico
│   ├── cadastro.html           # Tela de Cadastro de Usuários
│   └── calibracao.html         # Tela de Calibração Automática de Limiar
├── src/
│   └── landmarks.js            # Módulo de landmarks para o backend
├── tests/
│   └── test_face_access.js     # Suíte de testes automatizados com dados sintéticos
├── package.json                # Configuração e scripts Node.js
├── server.js                   # Servidor Node.js + rotas /verificar, /cadastrar, /calibracao
└── README.md                   # Documentação detalhada
```

---

## 🔍 Diagnóstico do Falso Aceite (Causa Raiz Matemática)

### Por que o sistema original aceitava pessoas não cadastradas?
O projeto original apresentava uma taxa crítica de **Falso Aceite (FAR)** devido a um erro conceitual na definição da escala de distância:

1. **A escala da distância "média por ponto" é de centésimos:**
   Após a extração dos pontos faciais, as coordenadas sofrem centralização no centroide, nivelamento angular do eixo inter-ocular (*roll alignment*) e escalonamento pela norma RMS (Procrustes). Nessa representação canônica:
   - O mesmo rosto (mesmo com variações naturais de iluminação e micro-movimentos): **distância entre 0.010 e 0.035**;
   - Rostos de pessoas distintas: **distância entre 0.070 e 0.160+**.
2. **O limiar inicial de 0.35 era inadequado e gigante:**
   Um limiar fixado em `0.35` (35 centésimos) representa de **3 a 5 vezes a distância típica entre dois seres humanos completamente desconhecidos**. Como a distância entre praticamente quaisquer duas pessoas nunca atinge 0.35 após normalização de escala, **qualquer estranho que olhasse para a câmera ficava abaixo de 0.35**, gerando aprovação imediata e indevida.
3. **Solução implementada:**
   - Adotou-se o **limiar padrão conservador de `0.0500` (5 centésimos)** na ausência de calibração;
   - Implementou-se a calibração automática orientada por dados para ajuste fino milimétrico ao sensor do usuário.

---

## 📐 Calibração Automática de Limiar (`calibracao.html`)

A calibração automática permite determinar experimentalmente a fronteira de decisão biométrica com base na teoria de detecção de sinais estatística:

1. **Coleta de Amostras Genuínas ("Sou Eu"):** O usuário legítimo captura 30 quadros em diferentes micro-ângulos. O sistema calcula o vetor médio $\bar{L}_{\text{gen}}$ e o conjunto de distâncias intra-classe $D_{\text{gen}}$.
2. **Coleta de Amostras Impostoras ("Outra Pessoa"):** Capturam-se 30 quadros de outra pessoa (ou amostras sintéticas de impostores para testes individuais), computando as distâncias inter-classe $D_{\text{imp}}$ em relação a $\bar{L}_{\text{gen}}$.
3. **Cálculo dos Percentis:**
   - **$P_{95}^{\text{gen}}$ (Percentil 95 Genuíno):** 95% das tentativas legítimas do usuário resultam em distância menor ou igual a esse valor.
   - **$P_{5}^{\text{imp}}$ (Percentil 5 Impostor):** Apenas 5% dos impostores mais parecidos conseguem chegar a uma distância tão baixa.
4. **Fórmula do Limiar Ótimo:**
   $$\text{Limiar} = \frac{P_{95}^{\text{gen}} + P_{5}^{\text{imp}}}{2}$$
5. **Avaliação das Taxas Biométricas:**
   - **Taxa de Falso Aceite (FAR):** Porcentagem de amostras impostoras com distância $< \text{Limiar}$ (objetivo: $0\%$).
   - **Taxa de Falso Negado (FRR):** Porcentagem de amostras genuínas com distância $\ge \text{Limiar}$.
6. **Persistência:** Ao salvar, o limiar e seus percentis são gravados em `data/calibracao.json` e aplicados instantaneamente no `/verificar`.

---

## ⚖️ Regras Mais Rígidas na Decisão Biométrica

Para blindar o sistema contra falso aceite, foram instituídas três salvaguardas mandatórias no `/verificar`:

### 1. Comparação contra a MÉDIA do Cadastro
- No cadastro (`/cadastrar`), 5 capturas estáveis são coletadas.
- O sistema calcula e armazena a média aritmética ponto a ponto ($\bar{L}_i = \frac{1}{5} \sum_{k=1}^5 L_{k, i}$), além de guardar as capturas brutas.
- A verificação compara a face candidata **estritamente contra o template médio**, eliminando o risco do método anterior (que utilizava a distância mínima entre as 5 capturas e aumentava a vulnerabilidade a ruídos pontuais).

### 2. Exigência de Margem de Segurança ($1.3\times$)
- Quando há 2 ou mais pessoas cadastradas na base de dados, além de exigir que a distância ao melhor candidato seja inferior ao limiar ($d_1 < \text{Limiar}$), exige-se que o segundo candidato mais próximo esteja a uma distância substancialmente superior:
  $$d_2 \ge 1.30 \times d_1 \iff \frac{d_2}{d_1} \ge 1.30$$
- Se a razão $\frac{d_2}{d_1} < 1.30$, a decisão é **RECUSADA por ambiguidade biométrica**, impedindo que pessoas parecidas ou gêmeos causem falso aceite.

### 3. Decisão por Média de 10 Frames Consecutivos
- O cliente mantém um buffer circular de 10 frames consecutivos em que uma face válida é detectada.
- O servidor calcula a distância de cada um dos 10 frames para o template médio do usuário e toma a decisão baseada na média das 10 distâncias:
  $$D_{\text{final}} = \frac{1}{10} \sum_{t=1}^{10} d(F_t, \bar{L})$$
- Evita que um frame isolado com artefato de iluminação ou ruído de câmera aprove um estranho ou rejeite um usuário legítimo.

---

## 🎯 Lista Documentada de Landmarks Estáveis (90 Pontos)

O MediaPipe FaceMesh fornece 468 pontos tridimensionais. Para garantir imunidade a expressões faciais e movimentos de fala, **foram excluídos 100% dos pontos da boca, lábios e sobrancelhas**.

Utilizam-se exclusivamente **90 pontos rígidos** da calota craniana e estrutura óssea:

```javascript
// Contorno do Rosto / Mandíbula óssea (36 pontos)
[10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
 54, 103, 67, 109]

// Olho Esquerdo - Borda orbital óssea fixa (16 pontos)
[33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]

// Olho Direito - Borda orbital óssea fixa (16 pontos)
[362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]

// Ponte Nasal - Glabela e dorso superior (5 pontos)
[168, 6, 197, 195, 5]

// Nariz - Dorso, ápice e asas nasais estruturais (17 pontos)
[4, 1, 19, 94, 2, 98, 97, 327, 326, 278, 48, 218, 438, 220, 440, 242, 462]
```

### Por que excluir boca e sobrancelhas?
- **Lábios e Boca:** Sofrem variações de mais de 200% durante a fala, respiração ou sorriso, introduzindo ruído de deformação elástica que mascara a identidade real da pessoa.
- **Sobrancelhas:** São controladas pelos músculos corrugador e frontal, mudando de posição a cada expressão de dúvida, surpresa ou concentração.

---

## 🧠 Modo Opcional: Embedding por Modelo Treinado (ONNX 512D)

O sistema suporta alternância entre dois modos de extração via configuração (`EMBEDDING_MODE="landmarks" | "modelo"`):

1. **Alinhamento Facial pelos Olhos no Navegador:**
   O MediaPipe detecta os centros oculares (pontos 33/133 e 362/263). O módulo `onnx_engine.js` aplica uma transformação afim 2D que rotaciona e escala o rosto para posicionar os olhos exatamente nas coordenadas fixas $(38, 48)$ e $(74, 48)$ em um canvas de $112 \times 112$ pixels.
2. **Inferência ONNX no Cliente (`onnxruntime-web`):**
   A imagem $112 \times 112$ é convertida em um Tensor planar $[1, 3, 112, 112]$ e processada pelo modelo **MobileFaceNet** localizado em `/models/mobilefacenet.onnx`.
3. **Similaridade de Cosseno & Normalização:**
   O modelo produz um vetor de 512 números normalizado em L2. A comparação biométrica utiliza a similaridade de cosseno:
   $$\text{Similaridade}(A, B) = \frac{A \cdot B}{\|A\|_2 \|B\|_2}$$
4. **Isolamento por `versaoModelo`:**
   - No modo landmarks: `versaoModelo = "landmarks-v1"`;
   - No modo modelo: `versaoModelo = "mobilefacenet-v1"`.
   - O endpoint `/verificar` ignora cadastros de versão diferente, permitindo demonstrações didáticas comparativas lado a lado sem conflito de base.

---

## 🚀 Como Executar a Aplicação

### 1. Pré-requisitos
- Node.js versão 18+ (testado no Node.js v24.1.0)
- Navegador moderno com suporte a WebRTC (`navigator.mediaDevices.getUserMedia`)

### 2. Instalação das Dependências
```bash
npm install
```

### 3. Iniciar o Servidor
```bash
npm start
```
Acesse no navegador: **`http://localhost:3000`**

---

## 🧪 Testes Automatizados com Dados Sintéticos

O projeto inclui uma suíte completa de testes biométricos que gera faces sintéticas canônicas tridimensionais para verificar o comportamento do algoritmo sob condições matemáticas controladas:

```bash
npm test
```

### O que o teste valida:
- ✅ **Discriminação de Limiar:** Um rosto diferente tem distância **ACIMA** do limiar ($> 0.05$), enquanto o mesmo rosto transformado tem distância **ABAIXO** ($< 0.05$).
- ✅ **Decisão pela MÉDIA:** O template facial compara contra a média das capturas com desvio estabilizado.
- ✅ **Regra de Margem ($1.3\times$):** Recusa imediata de candidatos ambíguos cuja razão $d_2 / d_1 < 1.30$ e aprovação quando a margem é satisfeita.
- ✅ **Janela de 10 Frames:** Amortecimento de spikes isolados de ruído de sensor sem comprometer a segurança.
- ✅ **Calibração Automática:** Cálculo correto de $P_{95}$, $P_5$, Limiar ótimo, FAR e FRR.
