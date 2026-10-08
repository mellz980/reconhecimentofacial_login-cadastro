import os
import json
import pytest
import numpy as np
import cv2
import base64
from storage import FaceStorage
from face_engine import FaceEngine
from app import app, storage, engine
import config

@pytest.fixture
def temp_storage(tmp_path):
    """Creates a temporary storage instance using PyTest's tmp_path."""
    json_file = tmp_path / "test_faces.json"
    key_file = tmp_path / "test_secret.key"
    storage_inst = FaceStorage(filepath=str(json_file), key_file=str(key_file), encrypt=False)
    return storage_inst

@pytest.fixture
def temp_encrypted_storage(tmp_path):
    """Creates a temporary encrypted storage instance."""
    json_file = tmp_path / "enc_faces.json"
    key_file = tmp_path / "enc_secret.key"
    storage_inst = FaceStorage(filepath=str(json_file), key_file=str(key_file), encrypt=True)
    return storage_inst

@pytest.fixture
def client(tmp_path):
    """Flask test client fixture with isolated test storage."""
    json_file = tmp_path / "app_faces.json"
    key_file = tmp_path / "app_secret.key"
    
    # Override storage in app module
    test_storage = FaceStorage(filepath=str(json_file), key_file=str(key_file), encrypt=False)
    app.config['TESTING'] = True
    
    # Monkeypatch storage in app
    import app as flask_app_module
    flask_app_module.storage = test_storage
    
    with flask_app_module.app.test_client() as test_client:
        yield test_client


class TestCosineSimilarity:
    """Test suite for Cosine Similarity and Normalized Mean calculation."""

    def test_identical_vectors(self):
        v1 = [0.5, 0.5, 0.5, 0.5]
        v2 = [0.5, 0.5, 0.5, 0.5]
        sim = FaceEngine.cosine_similarity(v1, v2)
        assert pytest.approx(sim, 0.0001) == 1.0

    def test_orthogonal_vectors(self):
        v1 = [1.0, 0.0, 0.0]
        v2 = [0.0, 1.0, 0.0]
        sim = FaceEngine.cosine_similarity(v1, v2)
        assert pytest.approx(sim, 0.0001) == 0.0

    def test_opposite_vectors(self):
        v1 = [1.0, 0.0]
        v2 = [-1.0, 0.0]
        sim = FaceEngine.cosine_similarity(v1, v2)
        assert pytest.approx(sim, 0.0001) == -1.0

    def test_normalized_mean_embedding(self):
        v1 = [1.0, 0.0]
        v2 = [0.0, 1.0]
        mean_norm = FaceEngine.compute_normalized_mean_embedding([v1, v2])
        
        norm = np.linalg.norm(mean_norm)
        assert pytest.approx(norm, 0.0001) == 1.0
        assert pytest.approx(mean_norm[0], 0.0001) == 0.70710678
        assert pytest.approx(mean_norm[1], 0.0001) == 0.70710678


class TestStorageJSON:
    """Test suite for reading, writing, and Fernet encryption of faces.json."""

    def test_write_and_read_unencrypted(self, temp_storage):
        user_vector = [0.1, 0.2, 0.3, 0.4]
        temp_storage.add_or_update_user(
            name="Alice Silva",
            embedding=user_vector,
            model="arcface",
            dimensions=4,
            samples=12
        )

        assert temp_storage.user_exists("Alice Silva") is True
        assert temp_storage.user_exists("alice silva") is True
        
        user = temp_storage.get_user_by_name("Alice Silva")
        assert user is not None
        assert user["name"] == "Alice Silva"
        assert user["dimensions"] == 4
        assert user["embedding"] == user_vector

    def test_fernet_encryption(self, temp_encrypted_storage):
        user_vector = [-0.5, 0.5, 0.25]
        temp_encrypted_storage.add_or_update_user(
            name="Bob Santos",
            embedding=user_vector,
            model="arcface",
            dimensions=3,
            samples=10
        )

        # Ensure raw file content is encrypted (not plain JSON text)
        with open(temp_encrypted_storage.filepath, 'rb') as f:
            raw_content = f.read()

        assert b"Bob Santos" not in raw_content

        # Load back via storage engine
        user = temp_encrypted_storage.get_user_by_name("Bob Santos")
        assert user is not None
        assert user["name"] == "Bob Santos"
        assert user["embedding"] == user_vector


class TestDuplicateUserRegistration:
    """Test suite for duplicate user registration and overwrite functionality."""

    def test_duplicate_user_overwrite(self, temp_storage):
        # 1. First registration
        vec1 = [0.1, 0.1, 0.1]
        temp_storage.add_or_update_user("Carlos", vec1, "arcface", 3, 10)
        
        user_first = temp_storage.get_user_by_name("Carlos")
        assert user_first["samples"] == 10
        assert user_first["embedding"] == vec1

        # 2. Overwrite registration
        vec2 = [0.9, 0.9, 0.9]
        temp_storage.add_or_update_user("Carlos", vec2, "arcface", 3, 15)

        users = temp_storage.get_all_users()
        assert len(users) == 1
        
        user_updated = temp_storage.get_user_by_name("Carlos")
        assert user_updated["samples"] == 15
        assert user_updated["embedding"] == vec2


class TestFlaskAPI:
    """Test suite for Flask HTTP endpoints and authentication flows."""

    def test_get_config(self, client):
        res = client.get('/api/config')
        assert res.status_code == 200
        data = res.get_json()
        assert "model_name" in data
        assert "similarity_threshold" in data

    def test_check_user_route(self, client):
        res = client.post('/api/check-user', json={"name": "UsuarioInexistente"})
        assert res.status_code == 200
        assert res.get_json()["exists"] is False

    def test_login_rate_limiting(self, client):
        import app as flask_app_module
        flask_app_module.login_attempts.clear()

        # Generate 5 consecutive invalid requests to trigger lockout limit
        for i in range(config.MAX_LOGIN_ATTEMPTS):
            res = client.post('/api/login', json={"image": ""})
            assert res.status_code == 400 or res.status_code == 200 or res.status_code == 429

        # Generate 1 frame failure
        dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)
        _, buffer = cv2.imencode('.jpg', dummy_img)
        b64 = "data:image/jpeg;base64," + base64.b64encode(buffer).decode('utf-8')

        for i in range(config.MAX_LOGIN_ATTEMPTS):
            res = client.post('/api/login', json={"image": b64})

        # Next request should return 429 locked out
        res_lockout = client.post('/api/login', json={"image": b64})
        assert res_lockout.status_code == 429
        assert res_lockout.get_json()["status"] == "locked_out"
