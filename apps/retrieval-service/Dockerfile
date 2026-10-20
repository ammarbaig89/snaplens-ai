FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY packages/contracts /app/packages/contracts
RUN pip install --no-cache-dir /app/packages/contracts
COPY apps/retrieval-service/app /app/app
RUN addgroup --system app && adduser --system --ingroup app app
USER app
EXPOSE 8003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
