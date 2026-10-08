import os
import time
import logging
from flask import Flask, render_template, request, jsonify
import config
from storage import FaceStorage
from face_engine import FaceEngine

# Configure Logging
logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s in %(module)s: %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'reconhecedor-facial-secret-key-2026'

# Initialize persistence and face engine
storage = FaceStorage()
engine = FaceEngine()

# In-memory tracking for login rate-limiting (IP-based)
# Format: { ip: {"attempts": int, "lockout_until": float} }
login_attempts = {}

def is_locked_out(ip: str) -> tuple[bool, int]:
    """Checks if the given IP address is currently locked out due to excessive failed attempts."""
    now = time.time()
    record = login_attempts.get(ip)
    if not record:
        return False, 0

    if record.get("lockout_until", 0) > now:
        remaining = int(record["lockout_until"] - now)
        return True, remaining
    
    # If lockout expired, reset counter
    if record.get("lockout_until", 0) <= now and record.get("attempts", 0) >= config.MAX_LOGIN_ATTEMPTS:
        login_attempts[ip] = {"attempts": 0, "lockout_until": 0}
        
    return False, 0

def record_failed_attempt(ip: str) -> int:
    """Records a failed login attempt and handles lockout threshold."""
    now = time.time()
    record = login_attempts.setdefault(ip, {"attempts": 0, "lockout_until": 0})
    record["attempts"] += 1

    if record["attempts"] >= config.MAX_LOGIN_ATTEMPTS:
        record["lockout_until"] = now + config.LOCKOUT_TIME_SECONDS
        logger.warning(f"IP {ip} atingiu o limite de {config.MAX_LOGIN_ATTEMPTS} falhas. Bloqueado por {config.LOCKOUT_TIME_SECONDS}s.")

    return record["attempts"]

def reset_login_attempts(ip: str):
    """Resets failed login attempts on successful authentication."""
    if ip in login_attempts:
        login_attempts[ip] = {"attempts": 0, "lockout_until": 0}


# ==================== PAGE ROUTES ====================

@app.route('/')
def index():
    return render_template('login.html', page='login')

@app.route('/login')
def page_login():
    return render_template('login.html', page='login')

@app.route('/cadastro')
def page_cadastro():
    return render_template('cadastro.html', page='cadastro')


# ==================== API ENDPOINTS ====================

@app.route('/api/config', methods=['GET'])
def get_config():
    """Returns current runtime configuration settings."""
    return jsonify({
        "model_name": engine.model_name,
        "dimensions": engine.dimensions,
        "similarity_threshold": config.SIMILARITY_THRESHOLD,
        "enable_liveness": config.ENABLE_LIVENESS,
        "encrypt_storage": storage.encrypt,
        "max_login_attempts": config.MAX_LOGIN_ATTEMPTS,
        "lockout_seconds": config.LOCKOUT_TIME_SECONDS,
        "num_registration_frames": config.NUM_REGISTRATION_FRAMES
    })

@app.route('/api/config/update', methods=['POST'])
def update_config():
    """Allows live modification of threshold, liveness, and encryption settings."""
    data = request.json or {}
    if "similarity_threshold" in data:
        try:
            val = float(data["similarity_threshold"])
            if 0.0 <= val <= 1.0:
                config.SIMILARITY_THRESHOLD = val
        except ValueError:
            pass

    if "enable_liveness" in data:
        config.ENABLE_LIVENESS = bool(data["enable_liveness"])

    if "encrypt_storage" in data:
        new_encrypt = bool(data["encrypt_storage"])
        if new_encrypt != storage.encrypt:
            # Re-save storage file with new encryption state
            users_data = storage.load_data()
            config.ENCRYPT_STORAGE = new_encrypt
            storage.encrypt = new_encrypt
            storage.save_data(users_data)

    return get_config()

@app.route('/api/check-user', methods=['POST'])
def check_user():
    """Checks if a user name is already registered."""
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Nome não fornecido."}), 400

    exists = storage.user_exists(name)
    return jsonify({"name": name, "exists": exists})

@app.route('/api/register', methods=['POST'])
def register_user():
    """
    Processes captured frames, validates face detection and liveness,
    computes normalized mean embedding, and persists user template.
    """
    data = request.json or {}
    name = data.get("name", "").strip()
    frames = data.get("frames", [])
    overwrite = data.get("overwrite", False)

    if not name:
        return jsonify({"status": "error", "message": "Por favor, informe o nome do usuário."}), 400

    if not frames or not isinstance(frames, list):
        return jsonify({"status": "error", "message": "Nenhum frame enviado para cadastro."}), 400

    # Check for duplicate user name
    if storage.user_exists(name) and not overwrite:
        return jsonify({
            "status": "duplicate",
            "message": f"O usuário '{name}' já possui cadastro.",
            "requires_confirmation": True
        }), 200

    valid_embeddings = []
    valid_bboxes = []
    error_reasons = []

    for idx, base64_str in enumerate(frames):
        img_np = engine.decode_base64_image(base64_str)
        if img_np is None:
            error_reasons.append(f"Frame {idx+1}: Imagem inválida.")
            continue

        result = engine.process_frame(img_np)
        if result["status"] == "ok":
            valid_embeddings.append(result["embedding"])
            valid_bboxes.append(result["bbox"])
        else:
            error_reasons.append(f"Frame {idx+1}: {result['message']}")

    # Ensure minimum number of valid face samples captured
    min_required = max(3, int(len(frames) * 0.5))
    if len(valid_embeddings) < min_required:
        return jsonify({
            "status": "error",
            "message": f"Falha no cadastro: Apenas {len(valid_embeddings)} de {len(frames)} frames continham um rosto claro.",
            "details": error_reasons
        }), 400

    # Optional Liveness check across captured frames
    liveness_ok, liveness_msg = engine.verify_liveness_movement(valid_bboxes)
    if not liveness_ok:
        return jsonify({
            "status": "error",
            "message": f"Falha de segurança (Vivacidade): {liveness_msg}"
        }), 400

    # Calculate normalized mean vector
    try:
        final_embedding = engine.compute_normalized_mean_embedding(valid_embeddings)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Erro ao calcular template facial: {e}"}), 500

    # Save to JSON storage
    saved_user = storage.add_or_update_user(
        name=name,
        embedding=final_embedding,
        model=engine.model_name,
        dimensions=engine.dimensions,
        samples=len(valid_embeddings)
    )

    logger.info(f"Usuário '{name}' cadastrado com sucesso com {len(valid_embeddings)} amostras.")
    return jsonify({
        "status": "success",
        "message": f"Cadastro concluído com sucesso para '{name}'!",
        "samples_used": len(valid_embeddings),
        "total_frames_sent": len(frames),
        "user": saved_user
    })

@app.route('/api/login', methods=['POST'])
def login():
    """
    Performs face login verification against stored templates using Cosine Similarity.
    Includes brute-force lockout protection.
    """
    client_ip = request.remote_addr or '127.0.0.1'
    locked, remaining_sec = is_locked_out(client_ip)
    if locked:
        return jsonify({
            "status": "locked_out",
            "access": "denied",
            "message": f"ACESSO BLOQUEADO – Muitas tentativas falhas. Aguarde {remaining_sec}s.",
            "remaining_seconds": remaining_sec
        }), 429

    data = request.json or {}
    image_base64 = data.get("image", "")
    if not image_base64:
        return jsonify({"status": "error", "message": "Nenhuma imagem capturada enviada."}), 400

    img_np = engine.decode_base64_image(image_base64)
    if img_np is None:
        return jsonify({"status": "error", "message": "Falha ao decodificar imagem."}), 400

    # Process frame with face engine
    result = engine.process_frame(img_np)
    if result["status"] != "ok":
        attempts = record_failed_attempt(client_ip)
        return jsonify({
            "status": "failed",
            "access": "denied",
            "message": "ACESSO NEGADO",
            "detail": result["message"],
            "score": 0.0,
            "threshold": config.SIMILARITY_THRESHOLD,
            "failed_attempts": attempts
        })

    candidate_embedding = result["embedding"]
    all_users = storage.get_all_users()

    if not all_users:
        return jsonify({
            "status": "failed",
            "access": "denied",
            "message": "ACESSO NEGADO",
            "detail": "Nenhum usuário cadastrado no sistema.",
            "score": 0.0,
            "threshold": config.SIMILARITY_THRESHOLD
        })

    best_user = None
    best_score = -1.0

    for user in all_users:
        stored_emb = user.get("embedding", [])
        if not stored_emb or len(stored_emb) != len(candidate_embedding):
            continue
        
        sim_score = engine.cosine_similarity(candidate_embedding, stored_emb)
        if sim_score > best_score:
            best_score = sim_score
            best_user = user

    best_score_round = round(best_score, 4)

    if best_user and best_score >= config.SIMILARITY_THRESHOLD:
        reset_login_attempts(client_ip)
        logger.info(f"Login LIBERADO para '{best_user['name']}' (Score: {best_score_round:.4f} >= {config.SIMILARITY_THRESHOLD})")
        return jsonify({
            "status": "success",
            "access": "granted",
            "message": f"ACESSO LIBERADO – Bem-vindo, {best_user['name']}",
            "user_name": best_user['name'],
            "score": best_score_round,
            "threshold": config.SIMILARITY_THRESHOLD
        })
    else:
        attempts = record_failed_attempt(client_ip)
        user_hint = best_user["name"] if best_user else "Desconhecido"
        logger.warning(f"Login NEGADO para IP {client_ip}. Maior score: {best_score_round:.4f} (Limiar: {config.SIMILARITY_THRESHOLD})")
        return jsonify({
            "status": "failed",
            "access": "denied",
            "message": "ACESSO NEGADO",
            "user_name": user_hint,
            "score": max(0.0, best_score_round),
            "threshold": config.SIMILARITY_THRESHOLD,
            "failed_attempts": attempts,
            "max_attempts": config.MAX_LOGIN_ATTEMPTS
        })

@app.route('/api/users', methods=['GET'])
def list_users():
    """Lists registered users (without embeddings for brevity)."""
    users = storage.get_all_users()
    sanitized = [
        {
            "name": u["name"],
            "model": u.get("model", "unknown"),
            "dimensions": u.get("dimensions", 0),
            "samples": u.get("samples", 0),
            "created_at": u.get("created_at", "")
        }
        for u in users
    ]
    return jsonify({"users": sanitized})


if __name__ == '__main__':
    print(f"--- Sistema de Reconhecimento Facial ---")
    print(f"Modelo: {engine.model_name} ({engine.dimensions}D)")
    print(f"Limiar de similaridade: {config.SIMILARITY_THRESHOLD}")
    print(f"Criptografia Fernet: {'Ativada' if storage.encrypt else 'Desativada'}")
    print(f"Servidor rodando em http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=False)
