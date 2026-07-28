FROM node:20-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/patient-miniapp/package.json apps/patient-miniapp/package.json
COPY services/main-service/package.json services/main-service/package.json
COPY packages/shared-contract/package.json packages/shared-contract/package.json
COPY packages/shared-constants/package.json packages/shared-constants/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY services/main-service/prisma ./services/main-service/prisma
RUN npm ci
RUN npx prisma generate --schema services/main-service/prisma/schema.prisma

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/main-service ./services/main-service
RUN npm run build -w @home-rehab-motion/main-service

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system home_rehab_motion && useradd --system --gid home_rehab_motion --home-dir /app home_rehab_motion
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/services/main-service/dist ./services/main-service/dist
COPY --from=build /app/services/main-service/prisma ./services/main-service/prisma
COPY --from=build /app/services/main-service/package.json ./services/main-service/package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /app/services/main-service/assets ./services/main-service/assets
USER home_rehab_motion
EXPOSE 3000
CMD ["node", "services/main-service/dist/services/main-service/src/main.js"]
