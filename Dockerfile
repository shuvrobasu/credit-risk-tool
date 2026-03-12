# Multi-stage build for a compact, production-ready image
# Stage 1: Build Frontend
FROM node:18-slim as frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
# Note: In production, we build; for a demo, we might serve via Vite or Nginx
RUN npm run build

# Stage 2: Final Image (Python Backend + Served Frontend)
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port (HF Spaces uses 7860 by default)
EXPOSE 7860

# Start command: FastAPI serving both API and Static Frontend
# We will need to update main.py to serve the /frontend/dist folder
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
