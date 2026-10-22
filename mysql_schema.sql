-- ============================================================================
-- FACE ACCESS - ESQUEMA DE BANCO DE DADOS PARA MYSQL / MARIADB
-- ============================================================================
-- Caso você precise executar em um servidor MySQL (XAMPP, MySQL Workbench, etc.)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS face_access CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE face_access;

-- 1. TABELA: pessoas
CREATE TABLE IF NOT EXISTS pessoas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(255) NOT NULL UNIQUE,
    versao_modelo VARCHAR(50) NOT NULL DEFAULT 'landmarks-v1',
    modo VARCHAR(50) NOT NULL DEFAULT 'landmarks',
    amostras INT NOT NULL DEFAULT 5,
    media_landmarks JSON NULL,
    media_embedding JSON NULL,
    capturas JSON NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pessoas_nome (nome),
    INDEX idx_pessoas_versao (versao_modelo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. TABELA: calibracoes
CREATE TABLE IF NOT EXISTS calibracoes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    limiar DECIMAL(7, 4) NOT NULL,
    p95_genuino DECIMAL(7, 4) NULL,
    p5_impostor DECIMAL(7, 4) NULL,
    far DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    frr DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    amostras_genuinas INT NOT NULL DEFAULT 0,
    amostras_impostoras INT NOT NULL DEFAULT 0,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_calibracoes_ativo (ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. TABELA: logs_acesso
CREATE TABLE IF NOT EXISTS logs_acesso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_nome VARCHAR(255) NULL,
    melhor_candidato VARCHAR(255) NULL,
    distancia_melhor DECIMAL(8, 5) NULL,
    segundo_candidato VARCHAR(255) NULL,
    distancia_segundo DECIMAL(8, 5) NULL,
    razao_margem DECIMAL(6, 2) NULL,
    limiar_aplicado DECIMAL(7, 4) NULL,
    modo VARCHAR(50) NULL,
    aprovado TINYINT(1) NOT NULL,
    motivo TEXT NULL,
    frames_avaliados INT DEFAULT 10,
    ip_origem VARCHAR(45) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_logs_criado_em (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
