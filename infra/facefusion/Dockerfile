# FaceFusion face-swap service.
#
# Wraps the official FaceFusion CPU image (Gradio UI + CLI, no REST API) with a
# tiny FastAPI server (server.py) that exposes the `headless-run` face swapper
# over HTTP so the backend can call it like any other provider.
FROM facefusion/facefusion:3.6.1-cpu

ENV PIP_BREAK_SYSTEM_PACKAGES=1

# FastAPI + uvicorn for the HTTP wrapper; python-multipart for file uploads.
RUN pip install --no-cache-dir "fastapi==0.115.6" "uvicorn==0.34.0" "python-multipart==0.0.20"

COPY infra/facefusion/server.py /facefusion/server.py
COPY infra/facefusion/entrypoint.sh /facefusion/entrypoint.sh
RUN chmod +x /facefusion/entrypoint.sh

EXPOSE 7865

# The entrypoint pre-downloads models into the persistent .assets volume on first
# boot, then starts the swap API.
CMD ["/facefusion/entrypoint.sh"]
