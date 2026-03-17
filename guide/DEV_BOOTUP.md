# EgoFlow Local Bootup

## 0) Docker install (Ubuntu only, first-time)

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh install-docker
```

After install, re-login once, then verify:

```bash
docker info
docker compose version
```

## 1) First-time setup (run once)

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh setup
```

This does:
- start `postgres` and `redis`
- create `backend/.env` if missing
- install backend dependencies
- run Prisma generate / migrate deploy / seed

## 2) Daily start

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh start
```

This does:
- start `postgres` and `redis`
- run backend dev server (`nodemon`)

## 3) Daily stop

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh stop
```

## 4) Full reset (if local DB/cache is broken)

```bash
cd ~/ego-flow/ego-flow-server
./scripts/dev.sh reset
./scripts/dev.sh setup
```
