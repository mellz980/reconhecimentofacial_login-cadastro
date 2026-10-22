-- ============================================================================
-- FACE ACCESS - ESQUEMA DE BANCO DE DADOS PARA O SUPABASE (PostgreSQL)
-- ============================================================================
-- IMPORTANTE: O Supabase utiliza PostgreSQL (não MySQL). 
-- Copie e cole este script diretamente no "SQL Editor" do seu painel do Supabase.
-- ============================================================================

-- Habilita extensão para geração de UUIDs (se ainda não estiver ativa)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. TABELA: pessoas (Armazena os templates biométricos faciais)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pessoas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(255) NOT NULL UNIQUE,
    versao_modelo VARCHAR(50) NOT NULL DEFAULT 'landmarks-v1', -- 'landmarks-v1' ou 'mobilefacenet-v1'
    modo VARCHAR(50) NOT NULL DEFAULT 'landmarks',              -- 'landmarks' ou 'modelo'
    amostras INT NOT NULL DEFAULT 5,
    media_landmarks JSONB,                                      -- Array dos 90 pontos norm. {x, y, z}
    media_embedding JSONB,                                      -- Array do vetor 512D normalizado L2
    capturas JSONB,                                             -- As 5 capturas completas originais
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de busca rápida
CREATE INDEX IF NOT EXISTS idx_pessoas_nome ON public.pessoas (LOWER(nome));
CREATE INDEX IF NOT EXISTS idx_pessoas_versao ON public.pessoas (versao_modelo);

-- Trigger para atualizar automaticamente o campo 'atualizado_em'
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_pessoas_atualizado_em ON public.pessoas;
CREATE TRIGGER trigger_pessoas_atualizado_em
    BEFORE UPDATE ON public.pessoas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. TABELA: calibracoes (Histórico e limiar ativo de calibração biométrica)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calibracoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    limiar NUMERIC(7, 4) NOT NULL,                              -- ex: 0.0521
    p95_genuino NUMERIC(7, 4),                                  -- ex: 0.0339
    p5_impostor NUMERIC(7, 4),                                  -- ex: 0.0703
    far NUMERIC(5, 2) NOT NULL DEFAULT 0.00,                    -- Taxa de falso aceite (%)
    frr NUMERIC(5, 2) NOT NULL DEFAULT 0.00,                    -- Taxa de falso negado (%)
    amostras_genuinas INT NOT NULL DEFAULT 0,
    amostras_impostoras INT NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calibracoes_ativo ON public.calibracoes (ativo);

-- ----------------------------------------------------------------------------
-- 3. TABELA: logs_acesso (Auditoria em tempo real de tentativas de acesso)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.logs_acesso (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_nome VARCHAR(255),
    melhor_candidato VARCHAR(255),
    distancia_melhor NUMERIC(8, 5),
    segundo_candidato VARCHAR(255),
    distancia_segundo NUMERIC(8, 5),
    razao_margem NUMERIC(6, 2),
    limiar_aplicado NUMERIC(7, 4),
    modo VARCHAR(50),
    aprovado BOOLEAN NOT NULL,
    motivo TEXT,
    frames_avaliados INT DEFAULT 10,
    ip_origem VARCHAR(45),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_criado_em ON public.logs_acesso (criado_em DESC);

-- ----------------------------------------------------------------------------
-- 4. POLÍTICAS DE SEGURANÇA (Row Level Security - RLS)
-- ----------------------------------------------------------------------------
-- Permite leitura e escrita pela API pública / anon key do Supabase
ALTER TABLE public.pessoas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calibracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs_acesso ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acesso publico pessoas" ON public.pessoas;
CREATE POLICY "Acesso publico pessoas" ON public.pessoas FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acesso publico calibracoes" ON public.calibracoes;
CREATE POLICY "Acesso publico calibracoes" ON public.calibracoes FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acesso publico logs" ON public.logs_acesso;
CREATE POLICY "Acesso publico logs" ON public.logs_acesso FOR ALL USING (true) WITH CHECK (true);
