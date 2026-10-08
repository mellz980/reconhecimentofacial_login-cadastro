import os

# Base Directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
FACES_FILE = os.path.join(DATA_DIR, 'faces.json')
KEY_FILE = os.path.join(DATA_DIR, 'secret.key')

# Face Recognition Settings
# Options: 'arcface' (InsightFace, 512D) or 'dlib' (face_recognition, 128D) or fallback
MODEL_NAME = 'arcface'

# Cosine similarity threshold for face verification (0.50 recommended for ArcFace)
SIMILARITY_THRESHOLD = 0.50

# Security & Robustness Settings
# Enable liveness detection check (movement / angle variance across frame samples)
ENABLE_LIVENESS = True

# Encrypt faces.json file with Fernet symmetric encryption
ENCRYPT_STORAGE = False

# Login Attempt Rate Limiting
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_TIME_SECONDS = 30

# Registration Settings
NUM_REGISTRATION_FRAMES = 12
