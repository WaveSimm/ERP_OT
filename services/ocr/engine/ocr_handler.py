import numpy as np
import os
import time


class OcrHandler:
    """멀티 엔진/모델 OCR 핸들러"""

    def __init__(self, model_dir: str = "/app/models"):
        self.model_dir = model_dir
        self._engines: dict = {}  # lazy-loaded engine cache
        self.claude_api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        self.clova_api_url = os.environ.get("CLOVA_OCR_API_URL", "")
        self.clova_api_key = os.environ.get("CLOVA_OCR_SECRET_KEY", "")

    # ── Public API ──────────────────────────────────────────────

    def get_available_engines(self) -> list[dict]:
        """사용 가능한 엔진 목록 반환"""
        engines = [
            {"id": "paddle-ko", "name": "PaddleOCR Korean", "group": "PaddleOCR", "lang": "korean", "ready": True},
        ]

        # Claude Vision API (Anthropic)
        claude_ready = bool(self.claude_api_key)
        engines.append(
            {"id": "claude-vision", "name": "Claude Vision (Sonnet)", "group": "Claude", "lang": "multi", "ready": claude_ready}
        )

        # CLOVA OCR API (Naver)
        clova_ready = bool(self.clova_api_url and self.clova_api_key)
        engines.append(
            {"id": "clova-ocr", "name": "CLOVA OCR (Naver)", "group": "CLOVA", "lang": "ko+en+ja", "ready": clova_ready}
        )

        return engines

    def detect(self, image: np.ndarray, engine_id: str = "paddle-ko") -> list:
        """
        지정 엔진으로 OCR 실행

        Returns:
            list of [box_coords, (text, confidence)]
        """
        group = engine_id.split("-")[0]

        if group == "paddle":
            return self._detect_paddle(image, engine_id)
        elif engine_id == "claude-vision":
            return self._detect_claude(image)
        elif engine_id == "clova-ocr":
            return self._detect_clova(image)
        else:
            raise ValueError(f"Unknown engine: {engine_id}")

    # ── PaddleOCR ───────────────────────────────────────────────

    def _get_paddle(self, engine_id: str):
        if engine_id not in self._engines:
            from paddleocr import PaddleOCR
            lang = "korean"
            self._engines[engine_id] = PaddleOCR(
                lang=lang,
                use_gpu=False,
                show_log=False,
                det_model_dir=f"{self.model_dir}/{engine_id}/det" if self.model_dir else None,
                rec_model_dir=f"{self.model_dir}/{engine_id}/rec" if self.model_dir else None,
            )
        return self._engines[engine_id]

    def _detect_paddle(self, image: np.ndarray, engine_id: str) -> list:
        ocr = self._get_paddle(engine_id)
        results = ocr.ocr(image, cls=True)
        if results and results[0]:
            return results[0]
        return []

    # ── Claude Vision (Anthropic API) ──────────────────────────

    def _detect_claude(self, image: np.ndarray) -> list:
        """
        Claude Vision API 호출 — 문서 이미지에서 텍스트 추출
        바운딩박스 없이 줄별 텍스트 반환 → 가상 좌표 생성
        """
        import anthropic
        import base64
        import cv2

        if not self.claude_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not configured")

        # 이미지 → base64 PNG
        _, img_bytes = cv2.imencode(".png", image)
        b64 = base64.b64encode(img_bytes.tobytes()).decode("utf-8")

        client = anthropic.Anthropic(api_key=self.claude_api_key)

        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                "이 문서 이미지의 모든 텍스트를 정확히 읽어주세요. "
                                "각 줄을 별도의 줄로 출력하세요. "
                                "표, 양식의 라벨과 값을 모두 포함하세요. "
                                "설명이나 해석 없이, 보이는 텍스트만 그대로 출력하세요."
                            ),
                        },
                    ],
                }
            ],
        )

        text_content = message.content[0].text
        lines = [line.strip() for line in text_content.split("\n") if line.strip()]

        # 줄별 가상 바운딩박스 생성
        img_h, img_w = image.shape[:2]
        converted = []
        for i, line in enumerate(lines):
            y_start = (i / max(len(lines), 1)) * img_h
            y_end = ((i + 1) / max(len(lines), 1)) * img_h
            bbox = [
                [0, y_start],
                [img_w, y_start],
                [img_w, y_end],
                [0, y_end],
            ]
            converted.append([bbox, (line, 0.98)])

        return converted

    # ── CLOVA OCR (Naver Cloud) ────────────────────────────────

    def _detect_clova(self, image: np.ndarray) -> list:
        """
        Naver CLOVA OCR General API 호출
        바운딩박스 + 텍스트 + 신뢰도 모두 반환
        """
        import httpx
        import base64
        import cv2
        import uuid

        if not self.clova_api_url or not self.clova_api_key:
            raise RuntimeError("CLOVA_OCR_API_URL or CLOVA_OCR_SECRET_KEY not configured")

        # 이미지 → base64 PNG
        _, img_bytes = cv2.imencode(".png", image)
        b64 = base64.b64encode(img_bytes.tobytes()).decode("utf-8")

        payload = {
            "version": "V2",
            "requestId": str(uuid.uuid4()),
            "timestamp": int(time.time() * 1000),
            "lang": "ko",
            "images": [
                {
                    "format": "png",
                    "name": "document",
                    "data": b64,
                }
            ],
        }

        headers = {
            "X-OCR-SECRET": self.clova_api_key,
            "Content-Type": "application/json",
        }

        r = httpx.post(
            self.clova_api_url,
            json=payload,
            headers=headers,
            timeout=30,
        )
        r.raise_for_status()
        result = r.json()

        converted = []
        for img_result in result.get("images", []):
            for field in img_result.get("fields", []):
                text = field.get("inferText", "")
                confidence = float(field.get("inferConfidence", 0))

                if not text.strip():
                    continue

                # CLOVA는 vertices (4점 좌표) 반환
                vertices = field.get("boundingPoly", {}).get("vertices", [])
                if len(vertices) == 4:
                    bbox = [
                        [vertices[0]["x"], vertices[0]["y"]],
                        [vertices[1]["x"], vertices[1]["y"]],
                        [vertices[2]["x"], vertices[2]["y"]],
                        [vertices[3]["x"], vertices[3]["y"]],
                    ]
                else:
                    # fallback: 가상 좌표
                    bbox = [[0, 0], [100, 0], [100, 20], [0, 20]]

                converted.append([bbox, (text, confidence)])

        return converted
