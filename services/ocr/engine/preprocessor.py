import cv2
import numpy as np
import io
from PIL import Image


class ImagePreprocessor:
    def load_image(self, file_bytes: bytes) -> np.ndarray:
        """바이트 → numpy 배열 변환 (이미지 + PDF 지원)"""
        # PDF 감지 (매직 바이트: %PDF)
        if file_bytes[:5] == b"%PDF-":
            return self._load_pdf(file_bytes)

        image = Image.open(io.BytesIO(file_bytes))
        # RGBA → RGB 변환
        if image.mode == "RGBA":
            image = image.convert("RGB")
        elif image.mode != "RGB":
            image = image.convert("RGB")
        return np.array(image)

    def _load_pdf(self, file_bytes: bytes) -> np.ndarray:
        """PDF 첫 페이지를 이미지로 변환 (PyMuPDF — 텍스트 레이어 포함 렌더링)"""
        import fitz
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc[0]
        mat = fitz.Matrix(300 / 72, 300 / 72)  # 300dpi
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        doc.close()
        return np.array(img)

    def process(self, image: np.ndarray) -> np.ndarray:
        """OCR 정확도 향상을 위한 전처리 파이프라인"""
        processed = image.copy()

        # 1. 이미지가 너무 작으면 확대
        h, w = processed.shape[:2]
        if max(h, w) < 1000:
            scale = 1000 / max(h, w)
            processed = cv2.resize(processed, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

        # 2. 그레이스케일 변환 (이미 컬러인 경우)
        if len(processed.shape) == 3:
            gray = cv2.cvtColor(processed, cv2.COLOR_RGB2GRAY)
        else:
            gray = processed

        # 3. 대비 향상 (CLAHE)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        # 4. 노이즈 제거 (가벼운 가우시안 블러)
        denoised = cv2.GaussianBlur(enhanced, (3, 3), 0)

        # 5. 다시 3채널로 (PaddleOCR는 컬러 이미지 기대)
        result = cv2.cvtColor(denoised, cv2.COLOR_GRAY2RGB)

        return result
