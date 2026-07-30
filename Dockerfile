# Pinned to the same Bun as package.json's packageManager field. Alpine because
# nothing here needs glibc — Bun runs the TypeScript directly, there is no build
# step and no native module.
FROM oven/bun:1.3.14-alpine

WORKDIR /app

# Dependencies first, as their own layer, so editing src does not re-resolve
# them. --production drops typescript, biome and @types/bun: none of it runs.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "src/index.ts"]
