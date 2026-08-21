# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy client files
COPY client/package*.json ./client/
COPY client/tsconfig.json ./client/
COPY client/vite.config.ts ./client/

# Install dependencies
RUN npm ci && cd client && npm ci && cd ..

# Copy source files
COPY server.ts .
COPY client/src ./client/src
COPY client/index.html ./client/

# Build client
RUN cd client && npm run build && cd ..

# Runtime stage
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built client
COPY --from=builder /app/client/dist ./public

# Copy server
COPY server.ts .

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start server
CMD ["npm", "start"]
