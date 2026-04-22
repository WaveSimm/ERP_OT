import os
import time
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from pydantic import BaseModel
from ocr_handler import OcrHandler
from preprocessor import ImagePreprocessor
from pdf_extractor import PdfExtractor

app = FastAPI(title="OCR Engine", version="2.0.0")

# 모델 로드 (lazy — 요청 시 초기화)
ocr_handler: OcrHandler | None = None
preprocessor = ImagePreprocessor()
pdf_extractor = PdfExtractor()


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class TextBlock(BaseModel):
    text: str
    confidence: float
    bounding_box: BoundingBox


class OcrScanResponse(BaseModel):
    engine_id: str
    texts: list[TextBlock]
    image_width: int
    image_height: int
    processing_time_ms: int
    extraction_method: str  # "text-extract" or "ocr"


class EngineInfo(BaseModel):
    id: str
    name: str
    group: str
    lang: str
    ready: bool


@app.on_event("startup")
async def startup():
    global ocr_handler
    model_dir = os.environ.get("MODEL_DIR", "/app/models")
    ocr_handler = OcrHandler(model_dir=model_dir)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ocr-engine",
        "model_loaded": ocr_handler is not None,
    }


@app.get("/engines", response_model=list[EngineInfo])
async def list_engines():
    """사용 가능한 OCR 엔진 목록"""
    if not ocr_handler:
        return []
    return ocr_handler.get_available_engines()


@app.post("/ocr/scan", response_model=OcrScanResponse)
async def scan_image(
    file: UploadFile = File(...),
    engine: str = Query(default="paddle-ko", description="OCR engine ID"),
    force_ocr: bool = Query(default=False, description="Skip PDF text extraction, force OCR"),
):
    if not ocr_handler:
        raise HTTPException(status_code=503, detail="OCR handler not initialized")

    # 엔진 유효성 확인
    available = {e["id"]: e for e in ocr_handler.get_available_engines()}
    if engine not in available:
        raise HTTPException(status_code=400, detail=f"Unknown engine: {engine}. Available: {list(available.keys())}")
    if not available[engine]["ready"]:
        raise HTTPException(status_code=400, detail=f"Engine '{engine}' is not installed")

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    start_time = time.time()

    try:
        # ── PDF 텍스트 추출 우선 시도 ──
        is_pdf = contents[:5] == b"%PDF-"
        if is_pdf and not force_ocr:
            result = pdf_extractor.extract(contents)
            if result is not None:
                # 텍스트 추출 성공 — OCR 불필요
                processing_time_ms = int((time.time() - start_time) * 1000)
                return OcrScanResponse(
                    engine_id="text-extract",
                    texts=result["texts"],
                    image_width=result["page_width"],
                    image_height=result["page_height"],
                    processing_time_ms=processing_time_ms,
                    extraction_method="text-extract",
                )
            # 텍스트 추출 실패 → OCR 폴백

        # ── OCR 처리 ──
        image = preprocessor.load_image(contents)

        # Cloud API 엔진은 원본 이미지 사용 (자체 전처리)
        # 로컬 엔진(paddle)만 전처리 적용
        cloud_engines = {"claude-vision", "clova-ocr"}
        if engine in cloud_engines:
            processed = image
        else:
            processed = preprocessor.process(image)

        img_height, img_width = processed.shape[:2]

        # OCR 실행 (지정 엔진)
        raw_results = ocr_handler.detect(processed, engine_id=engine)

        # 결과 변환 (좌표 정규화 0~1)
        texts: list[TextBlock] = []
        for line in raw_results:
            box_coords = line[0]
            text = line[1][0]
            confidence = float(line[1][1])

            xs = [p[0] for p in box_coords]
            ys = [p[1] for p in box_coords]
            x = min(xs) / img_width
            y = min(ys) / img_height
            w = (max(xs) - min(xs)) / img_width
            h = (max(ys) - min(ys)) / img_height

            texts.append(TextBlock(
                text=text,
                confidence=confidence,
                bounding_box=BoundingBox(x=x, y=y, width=w, height=h),
            ))

        processing_time_ms = int((time.time() - start_time) * 1000)

        return OcrScanResponse(
            engine_id=engine,
            texts=texts,
            image_width=img_width,
            image_height=img_height,
            processing_time_ms=processing_time_ms,
            extraction_method="ocr",
        )

    except Exception as e:
        raise HTTPException(status_code=422, detail=f"OCR processing failed ({engine}): {str(e)}")
