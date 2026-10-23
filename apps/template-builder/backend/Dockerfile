FROM python:3.12-slim

# tesseract: optional OCR for scanned pages.
# fonts: metric-compatible substitutes for Arial/Times/Courier used when a PDF's
# own fonts cannot be reused.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts

ENV STORAGE_DIR=/storage \
    DATA_DIR=/data \
    FONTS_DIR=/app/fonts \
    PYTHONUNBUFFERED=1
EXPOSE 8000
# hosts such as Render say which port to listen on in $PORT
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
