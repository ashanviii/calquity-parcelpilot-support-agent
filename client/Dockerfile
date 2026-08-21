# Build React app
FROM node:18-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json tsconfig.node.json vite.config.ts ./
COPY src ./src
COPY index.html ./

RUN npm ci && npm run build

# Serve with nginx
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
