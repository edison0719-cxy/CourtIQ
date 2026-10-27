FROM python:3.13-slim-bookworm
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 MPLBACKEND=Agg \
    OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4 \
    YOLO_CONFIG_DIR=/tmp/courtiq-yolo MPLCONFIGDIR=/tmp/courtiq-matplotlib
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libglib2.0-0 libgl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements/analysis.txt ./requirements.txt
# CPU wheels avoid installing the CUDA runtime in a CPU container.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.12.1 torchvision==0.27.1 \
    && pip install -r requirements.txt
COPY app.py pipeline.py analysis.py research.py services.py cloud_runner.py UPSTREAM_VERSIONS.json ./
COPY static ./static
COPY vendor/badminton-pipeline-repro/scripts ./vendor/badminton-pipeline-repro/scripts
RUN useradd --create-home --uid 10001 courtiq && mkdir -p /app/vendor/badminton-pipeline-repro/weights /app/data \
    && chown -R courtiq:courtiq /app
USER courtiq
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:8080/health',timeout=3)"
CMD ["uvicorn", "cloud_runner:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
