FROM python:3.11-slim

# ffmpeg is required by yt-dlp (audio extraction) and demucs (vocal separation).
# This is the Linux build; do NOT copy the old Windows ffmpeg.exe/ffprobe.exe.
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "worker.py"]
