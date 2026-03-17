# EgoFlow Tech Stack and Versions

Updated: 2026-03-17

## Runtime / Tooling

- Node.js: `v24.14.0` (local verified)
- npm: `11.9.0` (local verified)
- Docker Engine: `28.2.2` (local verified)
- Docker Compose plugin: `2.37.1`

## Infrastructure (docker-compose)

- PostgreSQL image: `postgres:16-alpine`
- Redis image: `redis:7-alpine`
- MediaMTX image: `bluenviron/mediamtx:latest`
  - Note: `latest` is mutable. For strict reproducibility, pin an explicit tag later.

## Backend (implemented in this repo)

Installed versions (`npm ls --depth=0`):

- `@prisma/client@6.16.3`
- `prisma@6.16.3` (kept on v6 intentionally for stability)
- `express@5.2.1`
- `typescript@5.9.3`
- `ts-node@10.9.2`
- `nodemon@3.1.14`
- `zod@4.3.6`
- `jsonwebtoken@9.0.3`
- `bcryptjs@3.0.3`
- `ioredis@5.10.0`
- `bullmq@5.71.0`
- `cors@2.8.6`
- `helmet@8.1.0`
- `morgan@1.10.1`
- `dotenv@17.3.1`
- `uuid@13.0.0`

Type packages:

- `@types/node@25.5.0`
- `@types/express@5.0.6`
- `@types/cors@2.8.19`
- `@types/morgan@1.9.10`
- `@types/jsonwebtoken@9.0.10`
- `@types/bcryptjs@2.4.6`
- `@types/uuid@10.0.0`

## Notes

- Prisma v7 migration is deferred for now; current project stays on Prisma v6.
- Current local bootup flow is documented in:
  - `guide/DEV_BOOTUP.md`
  - `scripts/dev.sh` (entrypoint)
