import cv2
import numpy as np
import base64
import logging
import config

logger = logging.getLogger(__name__)

class FaceEngine:
    """
    Core computer vision engine for face detection, embedding extraction, 
    similarity computation, and liveness verification.
    Primary backend: InsightFace (ArcFace 512D).
    Fallback backend: face_recognition / OpenCV cascade.
    """
    def __init__(self):
        self.model_name = config.MODEL_NAME
        self.app = None
        self.dimensions = 512
        self.use_fallback = False
        self._initialize_model()

    def _initialize_model(self):
        """Initializes InsightFace ArcFace model with fallback support."""
        if self.model_name == 'arcface':
            try:
                import insightface
                logger.info("Inicializando InsightFace (Modelo ArcFace, 512D)...")
                self.app = insightface.app.FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
                self.app.prepare(ctx_id=0, det_size=(640, 640))
                self.dimensions = 512
                logger.info("InsightFace carregado com sucesso.")
                return
            except Exception as e:
                logger.warning(f"Falha ao carregar InsightFace: {e}. Alternando para fallback face_recognition...")
                self.use_fallback = True

        # Fallback to face_recognition if requested or if InsightFace fails
        try:
            import face_recognition
            self.model_name = 'face_recognition'
            self.dimensions = 128
            self.use_fallback = True
            logger.info("Biblioteca face_recognition (128D) pronta para uso.")
        except Exception as e:
            logger.error(f"Nenhum modelo de reconhecimento facial pôde ser carregado: {e}")
            raise RuntimeError("Não foi possível inicializar InsightFace nem face_recognition.")

    @staticmethod
    def decode_base64_image(base64_string: str) -> np.ndarray | None:
        """Decodes a base64 encoded image string to OpenCV BGR numpy array."""
        try:
            if ',' in base64_string:
                base64_string = base64_string.split(',')[1]
            img_bytes = base64.b64decode(base64_string)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            return img
        except Exception as e:
            logger.error(f"Erro ao decodificar imagem base64: {e}")
            return None

    def process_frame(self, image_np: np.ndarray) -> dict:
        """
        Detects faces in frame and generates embedding.
        Returns dict with status ('ok', 'no_face', 'multiple_faces', 'error')
        and embedding list + face bbox if 1 face is found.
        """
        if image_np is None or image_np.size == 0:
            return {"status": "error", "message": "Imagem inválida ou vazia."}

        if not self.use_fallback and self.app is not None:
            # InsightFace ArcFace
            try:
                faces = self.app.get(image_np)
                num_faces = len(faces)
                if num_faces == 0:
                    return {"status": "no_face", "message": "Nenhum rosto detectado."}
                elif num_faces > 1:
                    return {"status": "multiple_faces", "message": "Mais de um rosto detectado. Mantenha apenas uma pessoa na câmera."}
                
                face = faces[0]
                embedding = face.embedding.tolist()
                bbox = [int(coord) for coord in face.bbox]
                kps = face.kps.tolist() if hasattr(face, 'kps') and face.kps is not None else []

                return {
                    "status": "ok",
                    "embedding": embedding,
                    "bbox": bbox,
                    "kps": kps,
                    "model": "arcface",
                    "dimensions": 512
                }
            except Exception as e:
                logger.error(f"Erro ao processar frame com InsightFace: {e}")
                return {"status": "error", "message": str(e)}
        else:
            # Fallback face_recognition
            try:
                import face_recognition
                rgb_img = cv2.cvtColor(image_np, cv2.COLOR_BGR2RGB)
                boxes = face_recognition.face_locations(rgb_img)
                num_faces = len(boxes)
                if num_faces == 0:
                    return {"status": "no_face", "message": "Nenhum rosto detectado."}
                elif num_faces > 1:
                    return {"status": "multiple_faces", "message": "Mais de um rosto detectado. Mantenha apenas uma pessoa na câmera."}
                
                encodings = face_recognition.face_encodings(rgb_img, boxes)
                if not encodings:
                    return {"status": "no_face", "message": "Não foi possível gerar embedding."}
                
                top, right, bottom, left = boxes[0]
                return {
                    "status": "ok",
                    "embedding": encodings[0].tolist(),
                    "bbox": [left, top, right, bottom],
                    "model": "face_recognition",
                    "dimensions": 128
                }
            except Exception as e:
                logger.error(f"Erro ao processar frame com face_recognition fallback: {e}")
                return {"status": "error", "message": str(e)}

    @staticmethod
    def compute_normalized_mean_embedding(embeddings: list[list[float]]) -> list[float]:
        """
        Calculates element-wise mean of multiple embedding vectors 
        and normalizes using L2 norm.
        """
        if not embeddings:
            raise ValueError("Lista de embeddings está vazia.")

        arr = np.array(embeddings, dtype=np.float64)
        mean_vec = np.mean(arr, axis=0)
        norm = np.linalg.norm(mean_vec)
        if norm == 0:
            return mean_vec.tolist()
        normalized = mean_vec / norm
        return normalized.tolist()

    @staticmethod
    def cosine_similarity(vec1: list[float] | np.ndarray, vec2: list[float] | np.ndarray) -> float:
        """
        Calculates Cosine Similarity between two embedding vectors.
        Formula: (A · B) / (||A|| * ||B||)
        Returns score between -1.0 and 1.0.
        """
        v1 = np.array(vec1, dtype=np.float64)
        v2 = np.array(vec2, dtype=np.float64)

        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)

        if norm1 == 0 or norm2 == 0:
            return 0.0

        similarity = np.dot(v1, v2) / (norm1 * norm2)
        return float(similarity)

    @staticmethod
    def verify_liveness_movement(bboxes: list[list[int]]) -> tuple[bool, str]:
        """
        Simple Liveness check: verifies if the face moved slightly across collected frames.
        Prevents static photo anti-spoofing during registration.
        """
        if not config.ENABLE_LIVENESS:
            return True, "Verificação de vivacidade desativada."

        if len(bboxes) < 3:
            return True, "Amostras suficientes para vivacidade."

        # Calculate variance of center X and center Y of facial bboxes
        centers_x = [(box[0] + box[2]) / 2.0 for box in bboxes]
        centers_y = [(box[1] + box[3]) / 2.0 for box in bboxes]

        std_x = float(np.std(centers_x))
        std_y = float(np.std(centers_y))

        # Also check width variation
        widths = [abs(box[2] - box[0]) for box in bboxes]
        std_w = float(np.std(widths))

        total_movement = std_x + std_y + std_w

        # If variance is virtually zero, it's likely a static printed photo placed in front of the lens
        if total_movement < 1.5:
            return False, "Movimento de vivacidade insuficiente. Por favor, movimente levemente a cabeça."

        return True, "Vivacidade confirmada."
