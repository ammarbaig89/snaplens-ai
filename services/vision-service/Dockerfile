FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY shared /app/shared
COPY services/vision-service/main.py /app/main.py
COPY services/vision-service/providers.py /app/providers.py
RUN addgroup --system app && adduser --system --ingroup app app
USER app
EXPOSE 8002
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
