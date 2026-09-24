# Medusa server (API + admin) built from the project in ./project: Medusa is
# distributed as npm packages to build a project with, not as an image.
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS build
ARG MEDUSA_VERSION=2.21.1
WORKDIR /build
COPY project/ ./
# @medusajs/* versions come from MEDUSA_VERSION (package.json placeholders).
RUN sed -i "s/\"MEDUSA_VERSION\"/\"${MEDUSA_VERSION}\"/" package.json \
    && npm install --no-audit --no-fund \
    && MEDUSA_DISABLE_TELEMETRY=true npx medusa build \
    # The build is a standalone project: install its production dependencies.
    && cd .medusa/server \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM node:${NODE_VERSION}-alpine
ARG MEDUSA_VERSION=2.21.1
ENV NODE_ENV=production \
    MEDUSA_DISABLE_TELEMETRY=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    MEDUSA_VERSION=${MEDUSA_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /build/.medusa/server/ ./
# Uploads (file-local provider): a volume owned by the app's user.
RUN mkdir -p static && chown node:node static
USER node
EXPOSE 9000
CMD ["npx", "medusa", "start"]
