FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/patient-miniapp/package.json apps/patient-miniapp/package.json
COPY services/main-service/package.json services/main-service/package.json
COPY packages/shared-contract/package.json packages/shared-contract/package.json
COPY packages/shared-constants/package.json packages/shared-constants/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/admin-web ./apps/admin-web
COPY packages ./packages
RUN npm run build -w @home-rehab-motion/admin-web

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin-web/dist /usr/share/nginx/html
EXPOSE 8080
