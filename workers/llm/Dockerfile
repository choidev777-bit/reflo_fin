FROM python:3.13-slim

WORKDIR /app
COPY workers/llm/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY workers/llm/app.py .
COPY docs/agents/HYPOTHESIS_AGENT_PROMPT_v2.md /app/docs/agents/HYPOTHESIS_AGENT_PROMPT_v2.md

ENV HYPOTHESIS_PROMPT_PATH=/app/docs/agents/HYPOTHESIS_AGENT_PROMPT_v2.md
EXPOSE 8093
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8093"]
