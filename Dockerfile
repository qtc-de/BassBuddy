# syntax=docker/dockerfile:1

# ---- Stage 1: compile the Rust pitch-detection crate to WebAssembly ----
FROM rust:1-slim AS wasm-builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add wasm32-unknown-unknown \
    && curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

WORKDIR /app
COPY pitch-wasm ./pitch-wasm
RUN wasm-pack build pitch-wasm --target web --out-dir /app/src/pitch-wasm

# ---- Stage 2: build the Vue app with Vite ----
FROM node:20-alpine AS app-builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
COPY --from=wasm-builder /app/src/pitch-wasm ./src/pitch-wasm
RUN npm run build

# ---- Stage 3: serve the static bundle ----
FROM nginx:alpine AS runtime
COPY --from=app-builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
