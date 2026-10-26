# Build context: repository root.  docker build -f deploy/Dockerfile .
# node:22-bookworm-slim is a multi-arch image (linux/arm64 and linux/amd64). The server has zero npm dependencies.
FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 HOST=0.0.0.0
WORKDIR /app
COPY server/package.json ./package.json
COPY server/src ./src
COPY server/bin ./bin
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "src/main.js"]
