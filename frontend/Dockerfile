FROM node:24-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

ARG VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1
ARG VITE_BACKEND_ORIGIN=http://127.0.0.1:3000

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_BACKEND_ORIGIN=$VITE_BACKEND_ORIGIN

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM base AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8088

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/server.mjs ./server.mjs

EXPOSE 8088

CMD ["npm", "run", "start"]
