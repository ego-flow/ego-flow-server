# EgoFlow Server Setup Guide

이 문서는 원격 서버에서 `ego-flow-server`를 처음 세팅하고 실행하는 절차를 정리한다. 대상 서버는 AWS EC2, OCI instance, self-hosted Linux server 등 Docker Compose를 실행할 수 있는 환경이면 된다.

현재 서버 실행 진입점은 `ego-flow-server/scripts/run.sh`이다. `backend`, `worker`, `dashboard`, `proxy`, `mediamtx`, `postgres`, `redis`가 하나의 `compose.yml`로 실행된다.

## 1. 서버 인스턴스 준비

서버 요구 사항:

- Linux server
- SSH 접속 가능
- `sudo` 권한이 있는 일반 사용자
- Docker Engine 및 Docker Compose v2
- repository clone을 위한 `git`

`./scripts/run.sh install-docker`는 Ubuntu 전용 helper이다. Ubuntu가 아닌 OS에서는 해당 OS의 공식 절차에 맞춰 Docker Engine과 Docker Compose plugin을 설치해야 한다.

## 2. 방화벽 / Security Group 설정

외부에서 접근해야 하는 포트는 다음과 같다.

| Port | Protocol | Required | Purpose |
| --- | --- | --- | --- |
| `22` | TCP | Yes | SSH 접속 |
| `80` | TCP | Yes | Dashboard, Backend API, Swagger UI, WHIP HTTP signaling ingress |
| `1935` | TCP | RTMP 사용 시 Yes | MediaMTX RTMP ingest endpoint for publisher connections |
| `1936` | TCP | RTMPS 사용 시 Yes | MediaMTX RTMPS ingest endpoint for encrypted publisher connections |
| `8888` | TCP | Yes | MediaMTX direct HLS playback endpoint |
| `8189` | UDP | WebRTC/WHIP 사용 시 Yes | MediaMTX WHIP/WebRTC ICE media endpoint |

내부 전용 포트는 외부에 열지 않는다.

| Port | Purpose |
| --- | --- |
| `3000` | Backend container internal port |
| `8088` | Dashboard container internal port |
| `8889` | MediaMTX WHIP/WebRTC internal HTTP port, Caddy가 public HTTP port에서 proxy |
| `9997` | MediaMTX control API internal port used by backend to inspect active paths and service state |
| `5432` | PostgreSQL database internal port |
| `6379` | Redis cache and BullMQ backend internal port |

기본 Caddy 설정은 plain HTTP `:80`만 사용한다. HTTPS는 현재 stack 설정 범위에 포함하지 않는다.

## 3. 서버 접속

```bash
ssh <user>@<server-ip>
```

Ubuntu minimal image라면 먼저 기본 도구를 설치한다.

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
```

## 4. Repository Clone

`ego-flow-server` repository를 clone한다.

```bash
git clone <repo-url>
cd ego-flow-server
```

parent repository 안에 submodule 형태로 받는 구조라면 다음처럼 진입한다.

```bash
git clone --recursive <parent-repo-url> ego-flow
cd ego-flow/ego-flow-server
```

## 5. Doctor로 현재 상태 확인

```bash
./scripts/run.sh doctor
```

초기 서버에서는 Docker, `config.json`, `.env`가 아직 없어서 실패할 수 있다. 이 단계는 현재 서버에 무엇이 부족한지 확인하는 용도로 사용한다.

`doctor`가 최종적으로 통과하려면 다음이 준비되어 있어야 한다.

- Docker daemon 접근 가능
- Docker Compose v2 사용 가능
- `ego-flow-server/config.json` 존재
- `ego-flow-server/.env` 존재

## 6. Docker 설치

Ubuntu 서버라면 제공된 helper를 사용할 수 있다.

```bash
./scripts/run.sh install-docker
```

이 명령은 내부적으로 다음을 수행한다.

- `docker.io` 설치
- `docker-compose-v2` 설치
- Docker service enable/start
- 현재 사용자를 `docker` group에 추가

설치 후에는 SSH session을 다시 열어야 한다. 그래야 현재 사용자에게 Docker group 권한이 적용된다.

```bash
exit
ssh <user>@<server-ip>
cd <repo-path>/ego-flow-server
docker info
docker compose version
```

private registry를 사용하거나 Docker Hub rate limit을 피해야 한다면 Docker login을 수행한다.

```bash
docker login
```

현재 기본 compose stack은 backend/frontend image를 로컬에서 build하고, `postgres`, `redis`, `caddy`, `mediamtx` public image를 pull한다.

## 7. 서버 설정 파일 생성

```bash
./scripts/setup-server-config.sh
```

이 스크립트는 interactive prompt로 `config.json`과 `.env`를 생성한다. 기존 파일이 있으면 입력 완료 후 덮어쓴다.

### config.json 주요 값

| Key | Example | Description |
| --- | --- | --- |
| `TARGET_DIRECTORY` | `~/ego-flow/ego-flow-data` | PostgreSQL, Redis, raw recording, processed dataset을 저장할 host data root |
| `CORS_ORIGIN` | `http://<server-ip>` | App/dashboard가 접근할 HTTP origin. 개발 중 넓게 열려면 `*` 사용 가능 |
| `WORKER_CONCURRENCY` | `2` | finalize worker 병렬 처리 수 |
| `DELETE_RAW_AFTER_PROCESSING` | `true` | processing 성공 후 raw segment 삭제 여부 |
| `JWT_EXPIRES_IN` | `24h` | JWT access token lifetime |
| `JWT_REFRESH_THRESHOLD_SECONDS` | `21600` | token refresh threshold |
| `SIGNED_FILE_URL_EXPIRES_IN` | `6h` | signed file URL lifetime |

`TARGET_DIRECTORY` 아래에는 다음 디렉터리가 만들어진다.

```text
{TARGET_DIRECTORY}/
├── postgres/
├── redis/
├── raw/
└── datasets/
```

### .env 주요 값

| Key | Description |
| --- | --- |
| `ADMIN_DEFAULT_PASSWORD` | seed admin account 기본 password |
| `JWT_SECRET` | JWT signing secret. production에서는 충분히 긴 random 값 사용 |
| `POSTGRES_USER` | PostgreSQL username |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `POSTGRES_DB` | PostgreSQL database name |
| `HF_TOKEN` | Hugging Face 연동이 필요한 경우만 입력 |
| `RTMPS_ENCRYPTION_MODE` | RTMPS 사용 시 `optional` 또는 `strict`; 미사용 시 blank 또는 `no` |
| `RTMPS_CERT_PATH` | container 기준 cert path. 기본 `/certs/server.crt` |
| `RTMPS_KEY_PATH` | container 기준 key path. 기본 `/certs/server.key` |

RTMPS를 실제로 사용할 경우 repository root의 `certs/` 아래에 인증서와 key를 준비하고, container path는 기본값인 `/certs/server.crt`, `/certs/server.key`를 사용한다.

## 8. 설정 확인

설정 파일 생성 후 다시 doctor를 실행한다.

```bash
./scripts/run.sh doctor
```

정상적인 경우 Docker, Compose, HTTP/RTMP/RTMPS port, HLS direct playback port, data root, config/env file 경로가 출력된다.

## 9. Stack 실행

```bash
./scripts/run.sh up
```

`up`은 다음을 수행한다.

1. Docker / Compose / config / env 확인
2. `TARGET_DIRECTORY` 준비 및 이전 data root migration 필요 여부 확인
3. `docker compose -f compose.yml up -d --build --remove-orphans`
4. `postgres`, `redis`, `backend`, `dashboard`, `proxy` health check 대기
5. `worker`, `mediamtx` running 상태 대기

backend container는 시작 시 Prisma schema push와 production seed를 수행한다.

## 10. 실행 확인

고정 HTTP port `80` 기준 확인 주소:

```text
Backend health: http://<server-ip>/api/v1/health
Swagger UI:     http://<server-ip>/api-docs
Dashboard:      http://<server-ip>
HLS output:     http://<server-ip>:8888/live/{repo}/{recordingSessionId}/index.m3u8?ticket={playback_ticket}
RTMP ingest:    rtmp://<server-ip>:1935/live
RTMPS ingest:   rtmps://<server-ip>:1936/live
```

App에서는 server host를 위 HTTP origin으로 설정한다. RTMP/RTMPS/WHIP publish URL은 app이 backend origin, publish-ticket 응답, 고정 port 계약을 기반으로 조립한다.

## 11. 운영 명령

```bash
./scripts/run.sh ps
./scripts/run.sh logs
./scripts/run.sh logs backend
./scripts/run.sh logs worker
./scripts/run.sh logs mediamtx
./scripts/run.sh down
./scripts/run.sh up
```

명령 의미:

- `ps`: compose service 상태 확인
- `logs [service]`: 전체 또는 특정 service 로그 확인
- `down`: stack 종료 및 container 제거
- `up`: build 포함 stack 시작/재시작
- `reset`: container, volume, `TARGET_DIRECTORY` data, `.run/target-directory` state 삭제

`reset`은 destructive command이므로 disposable 개발/테스트 환경에서만 사용한다.

## 12. 서버 업데이트

standalone `ego-flow-server` clone이라면:

```bash
cd ego-flow-server
git pull --ff-only
./scripts/run.sh up
```

parent `ego-flow` repository 안에서 submodule로 운영한다면 parent root의 helper를 사용할 수 있다.

```bash
cd ego-flow
./scripts/server-up.sh
```

`server-up.sh`는 실행 중인 stack을 내리고, parent repo와 submodule을 최신화한 뒤 `ego-flow-server/scripts/run.sh up`을 실행한다.

## 13. Troubleshooting

### Docker daemon 접근 실패

```text
Cannot access Docker daemon.
```

Docker service가 실행 중인지 확인한다.

```bash
sudo systemctl enable --now docker
```

`install-docker` 이후에도 같은 문제가 나면 SSH session을 종료하고 다시 접속한다.

### config.json 또는 .env 누락

```text
Missing config file
Missing env file
```

다시 설정 스크립트를 실행한다.

```bash
./scripts/setup-server-config.sh
```

### Port 충돌

`80`, `1935`, `1936`, `8888`, `8189/udp`를 이미 다른 프로세스가 사용 중이면 stack이 올라오지 않는다. 기존 프로세스를 종료한다.

RTMP/RTMPS/HLS/WebRTC port는 현재 고정 계약이므로 config로 변경하지 않는다.

### Service health check 실패

서비스별 로그를 확인한다.

```bash
./scripts/run.sh logs backend
./scripts/run.sh logs proxy
./scripts/run.sh logs mediamtx
./scripts/run.sh logs worker
```

### RTMPS publish 실패

RTMPS는 기본적으로 비활성화되어 있다. 사용하려면 다음을 확인한다.

- `1936/TCP` open
- `RTMPS_ENCRYPTION_MODE=optional` 또는 `strict`
- `certs/server.crt`, `certs/server.key` 존재
- `.env`의 cert/key path가 `/certs/...` container path 기준인지 확인

## 14. Security Notes

- SSH `22/TCP`는 가능하면 관리자 IP로 제한한다.
- `ADMIN_DEFAULT_PASSWORD`는 production에서 기본값을 사용하지 않는다.
- `JWT_SECRET`은 충분히 긴 random 값을 사용하고 외부에 노출하지 않는다.
- `.env`는 secret을 포함하므로 repository에 commit하지 않는다.
- `TARGET_DIRECTORY`는 persistent data root이므로 정기 backup 대상이다.
