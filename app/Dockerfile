# Produktions-Build: statische Dateien für Reverse-Proxy (Caddy/Nginx)
FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_APP_BUILD_NUMBER=0
ARG VITE_BASE=/
ENV VITE_APP_BUILD_NUMBER=$VITE_APP_BUILD_NUMBER
ENV VITE_BASE=$VITE_BASE
COPY package.json package-lock.json* ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.prod.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
