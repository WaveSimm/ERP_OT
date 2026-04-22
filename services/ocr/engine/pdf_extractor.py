import fitz  # PyMuPDF


# 텍스트 추출이 유의미한지 판단하는 최소 글자 수
MIN_TEXT_LENGTH = 20


class PdfExtractor:
    """PDF에서 텍스트 레이어 직접 추출 (OCR 불필요 시 사용)"""

    def extract(self, pdf_bytes: bytes, page_num: int = 0) -> dict | None:
        """
        PDF 텍스트 추출 시도.

        Returns:
            성공 시: {"texts": [TextBlock...], "page_width": int, "page_height": int}
            실패 시 (스캔 이미지 PDF 등): None → OCR 폴백 필요
        """
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        except Exception:
            return None

        if len(doc) == 0:
            doc.close()
            return None

        page = doc[min(page_num, len(doc) - 1)]
        page_width = int(page.rect.width)
        page_height = int(page.rect.height)

        # 텍스트 블록 추출 (위치 정보 포함)
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]

        texts = []
        total_chars = 0

        for block in blocks:
            if block["type"] != 0:  # 텍스트 블록만 (이미지 블록 제외)
                continue

            for line in block["lines"]:
                line_text = ""
                for span in line["spans"]:
                    line_text += span["text"]

                line_text = line_text.strip()
                if not line_text:
                    continue

                total_chars += len(line_text)

                # 바운딩박스 (정규화 0~1)
                bbox = line["bbox"]  # (x0, y0, x1, y1)
                x = bbox[0] / page_width if page_width else 0
                y = bbox[1] / page_height if page_height else 0
                w = (bbox[2] - bbox[0]) / page_width if page_width else 0
                h = (bbox[3] - bbox[1]) / page_height if page_height else 0

                texts.append({
                    "text": line_text,
                    "confidence": 1.0,  # 텍스트 추출은 100% 정확
                    "bounding_box": {"x": x, "y": y, "width": w, "height": h},
                })

        doc.close()

        # 텍스트가 너무 적으면 스캔 이미지 PDF로 판단 → OCR 폴백
        if total_chars < MIN_TEXT_LENGTH:
            return None

        return {
            "texts": texts,
            "page_width": page_width,
            "page_height": page_height,
        }
