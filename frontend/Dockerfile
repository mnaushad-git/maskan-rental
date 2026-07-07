FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

# Build a Node.js server (default Nitro target is cloudflare, which produces a
# Worker that can't run on a VPS). node-server emits a self-contained app at
# .output/server/index.mjs.
ENV NITRO_PRESET=node-server
RUN npm run build

# ── Runtime ────────────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# node-server output is self-contained (bundles its own node_modules).
COPY --from=builder /app/.output ./.output

EXPOSE 8080

ENV PORT=8080
ENV HOST=0.0.0.0

CMD ["node", ".output/server/index.mjs"]
