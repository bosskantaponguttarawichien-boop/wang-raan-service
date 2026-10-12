# syntax=docker/dockerfile:1.10
# =============================================================================
# วางร้าน (Wang-Raan) Backend — multi-stage production image
#
# core package อยู่บน GitHub Packages จึงต้องมี token ตอน `npm ci` — ส่งผ่าน BuildKit secret
# (ไม่ใช่ ARG/ENV) เพื่อไม่ให้ token ติดอยู่ใน layer ใดของ image:
#   docker build --secret id=npmrc,src=$HOME/.npmrc .                 # ใช้ ~/.npmrc ที่ npm login ไว้
#   NODE_AUTH_TOKEN=ghp_... docker build --secret id=NODE_AUTH_TOKEN .   # ใช้ token จาก env (CI/Railway)
# =============================================================================

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json .npmrc ./

# ติดตั้ง dependency พร้อม credentials จาก secret — คำสั่งเดียวกันใช้ทั้งชุด build และชุด production
# ไม่ใช้ --mount=type=cache: Railway บังคับ id=s/<service id>-... ที่ผูกกับ service เดียว ไม่งั้น Dockerfile ไม่ผ่าน validation
FROM base AS deps
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
    --mount=type=secret,id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN,required=false \
    if [ -n "${NODE_AUTH_TOKEN:-}" ]; then \
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
