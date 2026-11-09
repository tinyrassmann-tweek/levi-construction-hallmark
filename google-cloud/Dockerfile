FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY worker ./worker
COPY src/api.mjs ./src/api.mjs
COPY google-cloud/server.mjs ./google-cloud/server.mjs
ENV NODE_ENV=production
USER node
CMD ["node","google-cloud/server.mjs"]
