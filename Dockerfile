# syntax=docker/dockerfile:1.10
# =============================================================================
# วางร้าน (Wang-Raan) Backend — multi-stage production image
#
# core package อยู่บน GitHub Packages จึงต้องมี token ตอน `npm ci` — ส่งเป็น build arg NODE_AUTH_TOKEN:
#   NODE_AUTH_TOKEN=ghp_... docker build --build-arg NODE_AUTH_TOKEN .
# Railway ส่งตัวแปรของ service เป็น build arg ให้เอง แต่ไม่รองรับ RUN --mount (secret/cache) จึงใช้ BuildKit secret ไม่ได้
# ARG ประกาศเฉพาะใน stage deps — image สุดท้าย (runtime) เริ่มจาก base ใหม่และ copy มาแค่ node_modules/dist จึงไม่มี token
# ใช้ token ที่มีสิทธิ์ read:packages อย่างเดียว
# =============================================================================

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json .npmrc ./

# ติดตั้ง dependency พร้อม credentials จาก build arg — คำสั่งเดียวกันใช้ทั้งชุด build และชุด production
FROM base AS deps
ARG NODE_AUTH_TOKEN
RUN if [ -n "${NODE_AUTH_TOKEN:-}" ]; then \
      echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" > /tmp/auth.npmrc; \
      export NPM_CONFIG_USERCONFIG=/tmp/auth.npmrc; \
    fi; \
    npm ci && rm -f /tmp/auth.npmrc

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
