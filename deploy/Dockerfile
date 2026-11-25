# The match server only. Build from the top folder: docker build -f deploy/Dockerfile -t opengames-server .
FROM node:26-alpine
WORKDIR /srv
RUN npm install -g pnpm@10.32.1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY LICENSE library.lock.json ./
COPY app ./app
COPY games ./games
COPY kit ./kit
COPY server ./server
COPY web ./web
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=4310 DATA_DIR=/data STUN_PORT=3478 TRUST_PROXY=1
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4310/health || exit 1
CMD ["node", "server/main.js"]
