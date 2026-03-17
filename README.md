# EgoFlow (Backend Bootstrap)

RTMP 기반 EgoFlow 백엔드(Express + Prisma + PostgreSQL + Redis) 로컬 개발 부트스트랩 저장소입니다.

## What You Get

- Docker 기반 `postgres`, `redis`, `mediamtx` 인프라
- `backend` API 서버 (TypeScript)
- 1회/일상 실행 스크립트

## Repository Layout

- `backend/`: API 서버
- `scripts/`: 설치/부팅/정지/리셋 스크립트
- `guide/`: 구현 가이드 및 운영 문서
- `docker-compose.yml`: 로컬 인프라 정의

## Quick Start (First Time)

```bash
cd ~/ego-flow/ego-flow-server

# Ubuntu 환경에서 Docker 미설치 시 1회 실행
./scripts/dev.sh install-docker

# 최초 1회 세팅 (DB/Redis 기동 + env 생성 + npm install + prisma migrate/seed)
./scripts/dev.sh setup
```

주의:
- Docker 설치 후에는 터미널 재로그인(또는 새 세션)이 필요할 수 있습니다.
- Prisma는 현재 `v6` 고정입니다.

## Daily Start / Stop

시작:

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh start
```

종료:

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh stop
```

## Health Check

서버 실행 중:

```bash
curl -i http://127.0.0.1:3000/api/v1/health
```

정상 응답:

```json
{"status":"ok"}
```

## If Environment Breaks

로컬 DB/캐시까지 초기화 후 재세팅:

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh reset
./scripts/dev.sh setup
```

## Related Docs

- Bootup guide: [guide/DEV_BOOTUP.md](./guide/DEV_BOOTUP.md)
- Tech stack and versions: [guide/TECH_STACK_VERSIONS.md](./guide/TECH_STACK_VERSIONS.md)
- Implementation guide: [guide/EgoFlow_IMPLEMENTATION_GUIDE.md](./guide/EgoFlow_IMPLEMENTATION_GUIDE.md)
- Task roadmap: [guide/EgoFlow_TASK_ROADMAP.md](./guide/EgoFlow_TASK_ROADMAP.md)
- API spec: [guide/EgoFlow_API_SPEC.md](./guide/EgoFlow_API_SPEC.md)
