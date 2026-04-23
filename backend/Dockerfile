# TypeScript API — slim runtime: compile in build stage, ship dist + prod deps only
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations/007_users_and_ownership.sql ./migrations/007_users_and_ownership.sql
COPY migrations/008_next_step_deadline_timestamptz.sql ./migrations/008_next_step_deadline_timestamptz.sql
COPY migrations/010_optional_external_project_id.sql ./migrations/010_optional_external_project_id.sql
EXPOSE 5000
ENV PORT=5000
CMD ["node", "dist/index.js"]
