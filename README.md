# 👁️ Aplicação Web de Autenticação por Reconhecimento Facial

Aplicação web local em Python para cadastro e autenticação facial via webcam. Utiliza **Flask** no backend e **InsightFace (Modelo ArcFace, embeddings de 512 dimensões)** via OpenCV para extração e comparação de vetores faciais.

---

## 🚀 Tecnologias Utilizadas
- **Python 3.10+**
- **Backend:** Flask
- **Visão Computacional & IA:** OpenCV, InsightFace (ArcFace 512D), ONNX Runtime (Fallback para `face_recognition` / 128D se necessário)
- **Frontend:** HTML5, CSS3 moderno (Dark Mode com Glassmorphism) e JavaScript puro (`navigator.mediaDevices.getUserMedia`)
- **Persistência:** Arquivo JSON (`data/faces.json`) com suporte opcional a Criptografia Fernet (cryptography)
- **Testes:** Pytest

---

## 📁 Estrutura do Projeto

```text
reconhecedor_facial/
├── app.py                  # Servidor Flask e rotas da API
├── config.py               # Configurações do sistema (limiar, liveness, criptografia)
├── face_engine.py          # Motor de detecção facial, embeddings, similaridade e vivacidade
├── storage.py              # Leitura/escrita do faces.json e criptografia Fernet
├── templates/              # Páginas HTML (login.html e cadastro.html)
├── static/                 # Estilos CSS e rotinas JavaScript do cliente
│   ├── style.css
│   └── script.js
├── data/                   # Diretório de persistência
│   ├── faces.json          # Banco de dados biométrico JSON
│   └── secret.key          # Chave de criptografia Fernet (se ativada)
├── tests/                  # Suíte de testes automatizados
│   └── test_facial_auth.py
├── requirements.txt        # Dependências do projeto com versões fixadas
└── README.md               # Instruções e documentação
```

---

## ⚙️ Instalação e Execução

### 1. Clonar ou Acessar o Diretório
```bash
cd reconhecedor_facial
```

### 2. Criar e Ativar um Ambiente Virtual (Recomendado)
```bash
python -m venv venv

# No Windows:
venv\Scripts\activate

# No Linux/macOS:
source venv/bin/activate
```

### 3. Instalar Dependências
```bash
pip install -r requirements.txt
```

### 4. Executar a Aplicação
```bash
python app.py
```
Acesse no navegador: **`http://127.0.0.1:5000`**

---

## 🧪 Executando os Testes Automatizados

Para executar a suíte de testes (similaridade de cosseno, persistência JSON, criptografia Fernet, cadastro duplicado e rotas Flask):

```bash
python -m pytest tests/test_facial_auth.py
```

---

## 📐 Ajuste do Limiar de Similaridade (Calibração)

A comparação facial utiliza a **Similaridade de Cosseno** entre vetores faciais normalizados $A$ e $B$:

$$\text{Similaridade}(A, B) = \frac{A \cdot B}{\|A\|_2 \|B\|_2}$$

O limiar inicial é configurado no arquivo `config.py`:
```python
SIMILARITY_THRESHOLD = 0.50
```

### Guia de Calibração:
- **0.50 a 0.60 (Recomendado para ArcFace 512D):** Excelente equilíbrio entre segurança e facilidade de acesso.
- **Acima de 0.65:** Maior rigor de segurança. Pode exigir iluminação ideal e posição frontal estrita.
- **Abaixo de 0.40:** Pode aumentar a taxa de falsos aceites.

---

## 🔒 Segurança, Vivacidade e LGPD

### ⚠️ AVISO DE PRIVACIDADE E DADOS BIOMÉTRICOS (LGPD)
> O arquivo `data/faces.json` armazena vetores numéricos de representação facial (embeddings). Segundo a **Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018)**, dados biométricos são classificados como **dados pessoais sensíveis** e exigem proteção adequada contra acesso não autorizado.

### Criptografia Fernet (Opcional)
Para criptografar o arquivo de dados biométricos em disco usando a biblioteca `cryptography` (Fernet):
1. Abra `config.py`.
2. Altere a opção para `True`:
```python
ENCRYPT_STORAGE = True
```
3. Na primeira execução com criptografia ativada, a chave secreta será gerada automaticamente em `data/secret.key`.

### Verificação de Vivacidade (Liveness Detection)
- O sistema exige que o usuário movimente levemente a cabeça durante os 12 frames do cadastro. A variação espacial das caixas delimitadoras e pontos faciais evita ataques simples com fotos impressas ou em telas de celulares.
- Pode ser ativada/desativada em `config.py`:
```python
ENABLE_LIVENESS = True
```

### Proteção Contra Força Bruta
- Limite de **5 tentativas consecutivas de falha** por cliente/IP.
- Bloqueio temporário de **30 segundos** após atingir o limite.

---

## 🖼️ Fluxo de Uso das Telas

### Tela 1: Cadastro (`/cadastro`)
1. Digite o nome completo e clique em **"Iniciar Cadastro Facial"**.
2. A webcam capturará de 10 a 15 quadros.
3. Se o nome já existir, uma janela de confirmação solicitará se você deseja sobrescrever o cadastro.
4. O vetor médio é normalizado (L2 norm) e salvo em `data/faces.json`.

### Tela 2: Login (`/login`)
1. Posicione o rosto na câmera e clique em **"Entrar por Reconhecimento Facial"**.
2. O sistema comparará o rosto com todos os usuários cadastrados.
3. Exibição de resultado:
   - 🟢 **"ACESSO LIBERADO – Bem-vindo, [Nome]"** (Score $\ge$ Limiar)
   - 🔴 **"ACESSO NEGADO"** (Score $<$ Limiar ou nenhum rosto detectado)
