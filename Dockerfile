FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
RUN mkdir -p output

# Default command can be overridden by docker compose services.
CMD ["node", "src/viewer-server.js"]
