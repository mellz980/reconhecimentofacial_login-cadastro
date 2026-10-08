import os
import json
from datetime import datetime
from cryptography.fernet import Fernet
import config

class FaceStorage:
    """
    Persistence layer for face embeddings using JSON storage.
    Supports optional Fernet symmetric encryption according to config.
    """
    def __init__(self, filepath=None, key_file=None, encrypt=None):
        self.filepath = filepath or config.FACES_FILE
        self.key_file = key_file or config.KEY_FILE
        self.encrypt = config.ENCRYPT_STORAGE if encrypt is None else encrypt
        self._ensure_data_directory()

    def _ensure_data_directory(self):
        """Creates data directory and default JSON file if they do not exist."""
        data_dir = os.path.dirname(self.filepath)
        if data_dir and not os.path.exists(data_dir):
            os.makedirs(data_dir, exist_ok=True)
        if not os.path.exists(self.filepath):
            self.save_data({"users": []})

    def _get_fernet(self) -> Fernet:
        """Loads existing key or creates a new key for Fernet encryption."""
        if not os.path.exists(self.key_file):
            key = Fernet.generate_key()
            with open(self.key_file, 'wb') as f:
                f.write(key)
        else:
            with open(self.key_file, 'rb') as f:
                key = f.read().strip()
        return Fernet(key)

    def load_data(self) -> dict:
        """Reads and parses the faces dataset (decrypting if enabled)."""
        if not os.path.exists(self.filepath):
            return {"users": []}

        try:
            with open(self.filepath, 'rb') as f:
                content = f.read()

            if not content.strip():
                return {"users": []}

            if self.encrypt:
                fernet = self._get_fernet()
                decrypted_bytes = fernet.decrypt(content)
                text_data = decrypted_bytes.decode('utf-8')
            else:
                text_data = content.decode('utf-8')

            return json.loads(text_data)
        except Exception as e:
            # Fallback if unencrypted read fails on encrypted file or vice-versa
            if not self.encrypt:
                try:
                    fernet = self._get_fernet()
                    decrypted_bytes = fernet.decrypt(content)
                    return json.loads(decrypted_bytes.decode('utf-8'))
                except Exception:
                    pass
            raise IOError(f"Erro ao carregar dados biométricos do arquivo {self.filepath}: {e}")

    def save_data(self, data: dict):
        """Saves data dict into JSON file (encrypting if enabled)."""
        json_str = json.dumps(data, indent=2, ensure_ascii=False)
        raw_bytes = json_str.encode('utf-8')

        if self.encrypt:
            fernet = self._get_fernet()
            file_bytes = fernet.encrypt(raw_bytes)
        else:
            file_bytes = raw_bytes

        with open(self.filepath, 'wb') as f:
            f.write(file_bytes)

    def get_all_users(self) -> list:
        """Returns the list of all registered users."""
        data = self.load_data()
        return data.get("users", [])

    def user_exists(self, name: str) -> bool:
        """Checks if a user with the given name already exists (case-insensitive)."""
        users = self.get_all_users()
        target = name.strip().lower()
        return any(u["name"].strip().lower() == target for u in users)

    def get_user_by_name(self, name: str) -> dict | None:
        """Finds a user by name (case-insensitive)."""
        users = self.get_all_users()
        target = name.strip().lower()
        for user in users:
            if user["name"].strip().lower() == target:
                return user
        return None

    def add_or_update_user(self, name: str, embedding: list[float], model: str, dimensions: int, samples: int) -> dict:
        """
        Adds a new user or updates an existing user record.
        Returns the saved user dict.
        """
        data = self.load_data()
        users = data.get("users", [])
        
        created_at = datetime.now().isoformat(timespec='seconds')
        user_record = {
            "name": name.strip(),
            "embedding": [float(x) for x in embedding],
            "model": model,
            "dimensions": dimensions,
            "samples": samples,
            "created_at": created_at
        }

        # Check if already exists to update
        existing_index = None
        target = name.strip().lower()
        for idx, u in enumerate(users):
            if u["name"].strip().lower() == target:
                existing_index = idx
                break

        if existing_index is not None:
            users[existing_index] = user_record
        else:
            users.append(user_record)

        data["users"] = users
        self.save_data(data)
        return user_record
