# Multi-stage production build for SAATH
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies for native modules if needed
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json .npmrc ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# Production runtime stage
FROM node:20-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV SQLITE_PATH=/app/data/saath.db
ENV UPLOADS_DIR=/app/data/uploads

RUN mkdir -p /app/data && chown -R node:node /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER node
EXPOSE 3000

VOLUME ["/app/data"]

CMD ["npm", "start"]
