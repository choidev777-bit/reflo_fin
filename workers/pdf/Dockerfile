FROM python:3.13.7-slim

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py analysis_profile.json ./

ENV PORT=8091
EXPOSE 8091
CMD ["python", "app.py"]
