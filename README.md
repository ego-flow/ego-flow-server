# EgoFlow (Backend Bootstrap)

RTMP 기반 EgoFlow 백엔드(Express + Prisma + PostgreSQL + Redis + MediaMTX) 로컬 개발 부트스트랩 저장소입니다.

## What You Get

- Docker 기반 `postgres`, `redis`, `mediamtx` 인프라
- `backend/` Express + TypeScript API 서버
- BullMQ 기반 video processing worker
- 초보 사용자가 그대로 따라도 되는 `./scripts/dev.sh` 단일 진입점
- `docker compose up -d` 로 바로 띄울 수 있는 backend + worker 통합 스택

## Fastest Start

처음 clone 받은 뒤 가장 간단한 실행 순서는 아래입니다.

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh start
./scripts/dev.sh worker
```

`start`와 `worker`는 둘 다 Compose 기반으로 동작합니다.

- `start`: `postgres`, `redis`, `backend`, `mediamtx`를 `up -d --build`
- `worker`: `worker`를 `up -d --build`

즉, 실제 서버 기동은 로컬 `ts-node`가 아니라 Compose 스택으로 통일되어 있습니다.

## First Time Setup

### 0. Docker 설치가 안 된 Ubuntu 환경

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh install-docker
```

설치 후에는 터미널을 한 번 다시 열거나 재로그인해서 Docker group 권한을 반영하는 편이 안전합니다.

확인:

```bash
docker info
docker compose version
```

### 1. Bootstrap만 먼저 해두고 싶을 때

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh setup
```

`setup`은 서버를 띄우지 않고 아래만 수행합니다.

- `backend/.env` 생성(없을 때만)
- 로컬 `backend` 의존성 설치
- 로컬 Prisma client generate

여러 번 다시 실행해도 괜찮게 구성되어 있습니다.

## Daily Flow

백엔드 시작:

```bash
./scripts/dev.sh start
```

워커 시작:

```bash
./scripts/dev.sh worker
```

인프라 종료:

```bash
./scripts/dev.sh stop
```

주의:

- `start`와 `worker`는 둘 다 Compose 기반 `up -d --build` 명령입니다.
- 코드 수정 후 다시 반영하려면 해당 명령을 다시 실행하면 됩니다.
- `stop`은 Compose 스택 전체를 멈춥니다.
- 예전의 로컬 pidfile/foreground dev server 흐름은 더 이상 쓰지 않습니다.

## Full Docker Stack

로컬 호스트에서 Node 프로세스를 따로 띄우지 않고 전체 스택을 Compose로 확인하고 싶다면:

```bash
cd ~/ego-flow/ego-flow-server
docker compose up -d
```

이 경로는 다음 서비스를 함께 기동합니다.

- `postgres`
- `redis`
- `backend`
- `worker`
- `mediamtx`

동작 방식:

- `backend` 컨테이너가 시작 시 `prisma migrate deploy`와 production seed를 수행합니다.
- `worker`는 같은 이미지를 사용하고 `npm run worker:start`로 실행됩니다.
- `TARGET_DIRECTORY`는 컨테이너 내부 `/data/datasets`를 사용하며, 호스트의 `./data/datasets`와 bind mount 됩니다.
- raw recordings도 `./data/raw`와 bind mount 됩니다.

확인:

```bash
docker compose ps
curl -i http://127.0.0.1:3000/api/v1/health
```

정리:

```bash
docker compose down
```

## Scripts

실행 진입점은 사실상 `./scripts/dev.sh` 하나만 보면 됩니다.

- `./scripts/dev.sh check`
  - `docker`, `docker compose`, `node`, `npm`, Docker daemon 접근 가능 여부를 확인합니다.
- `./scripts/dev.sh setup`
  - `.env` 준비, 로컬 의존성 설치, 로컬 Prisma client generate만 수행합니다.
  - safe to re-run 입니다.
- `./scripts/dev.sh start`
  - Compose로 `postgres`, `redis`, `backend`, `mediamtx`를 `up -d --build` 합니다.
  - backend 컨테이너가 시작 시 migration + seed를 자동 수행합니다.
- `./scripts/dev.sh worker`
  - Compose로 `worker`를 `up -d --build` 합니다.
  - 일반적으로 `start` 이후 실행하면 됩니다.
- `./scripts/dev.sh stop`
  - Compose 스택 전체를 `stop` 합니다.
- `./scripts/dev.sh reset`
  - Docker containers/volumes와 로컬 Redis bind-mount 데이터를 제거합니다.
  - 로컬 환경이 꼬였을 때만 사용하세요.
- `./scripts/dev.sh install-docker`
  - Ubuntu에서 Docker Engine과 Compose plugin을 설치합니다.

## Recommended Order

### 가장 간단한 권장 순서

1. `./scripts/dev.sh start`
2. `./scripts/dev.sh worker`

### bootstrap만 먼저 하고 싶은 경우

1. `./scripts/dev.sh setup`
2. `./scripts/dev.sh start`
3. `./scripts/dev.sh worker`

### 로컬 환경이 깨졌을 때

1. `./scripts/dev.sh reset`
2. `./scripts/dev.sh start`
3. `./scripts/dev.sh worker`

## Health Check

서버 실행 중:

```bash
curl -i http://127.0.0.1:3000/api/v1/health
```

정상 응답:

```json
{"status":"ok"}
```

## Repository Layout

- `backend/`: API 서버와 worker
- `scripts/`: 로컬 실행 스크립트
- `guide/`: 구현 가이드 및 API/roadmap 문서
- `docker-compose.yml`: 인프라 + backend + worker 통합 Compose 정의

## Tech Stack and Versions

Updated: 2026-03-19

### Runtime / Tooling

- Node.js: `v24.14.0` (local verified)
- npm: `11.9.0` (local verified)
- Docker Engine: `28.2.2` (local verified)
- Docker Compose plugin: `2.37.1`

### Infrastructure

- PostgreSQL image: `postgres:16-alpine`
- Redis image: `redis:7-alpine`
- MediaMTX image: `bluenviron/mediamtx:latest`
- Backend/Worker image: local build from `backend/Dockerfile`

Note:

- `mediamtx:latest`는 mutable tag입니다. 엄격한 재현성이 필요하면 추후 명시적인 tag pinning이 필요합니다.

### Backend

주요 패키지 버전:

- `@prisma/client@6.16.3`
- `prisma@6.16.3`
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

타입 패키지:

- `@types/node@25.5.0`
- `@types/express@5.0.6`
- `@types/cors@2.8.19`
- `@types/morgan@1.9.10`
- `@types/jsonwebtoken@9.0.10`
- `@types/bcryptjs@2.4.6`
- `@types/uuid@10.0.0`

## Notes

- Prisma는 현재 의도적으로 `v6` 라인을 유지합니다.
- `setup`은 로컬 개발 도구 준비용이고, 실제 서버 기동은 Compose 기반으로 통일되었습니다.
- 코드 변경 후에도 `./scripts/dev.sh start` 또는 `./scripts/dev.sh worker`를 다시 실행하면 Compose가 build/recreate를 담당합니다.

## Related Docs

- Implementation guide: [guide/EgoFlow_IMPLEMENTATION_GUIDE.md](./guide/EgoFlow_IMPLEMENTATION_GUIDE.md)
- Task roadmap: [guide/EgoFlow_TASK_ROADMAP.md](./guide/EgoFlow_TASK_ROADMAP.md)
- API spec: [guide/EgoFlow_API_SPEC.md](./guide/EgoFlow_API_SPEC.md)
