FROM node:24-alpine AS build

WORKDIR /app
COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine

ARG BUILD_VERSION=dev
ARG BUILD_ARCH=amd64

LABEL io.hass.version="${BUILD_VERSION}" \
      io.hass.type="app" \
      io.hass.arch="${BUILD_ARCH}"

WORKDIR /app

RUN apk add --no-cache jq

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY run.sh /run.sh

RUN chmod +x /run.sh

EXPOSE 8765

CMD ["/run.sh"]
