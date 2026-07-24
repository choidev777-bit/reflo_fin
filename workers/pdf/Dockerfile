FROM python:3.13.7-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

ENV PORT=8091
EXPOSE 8091
CMD ["python", "app.py"]
