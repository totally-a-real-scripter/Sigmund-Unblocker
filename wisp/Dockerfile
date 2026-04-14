FROM python:3.12-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir git+https://github.com/MercuryWorkshop/wisp-server-python.git

EXPOSE 4000
CMD ["python", "-m", "wisp_server", "--host", "0.0.0.0", "--port", "4000"]
