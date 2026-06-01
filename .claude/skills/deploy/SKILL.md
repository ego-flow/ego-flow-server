---
name: deploy
description: Build EgoFlow backend/worker/dashboard images on this host, push to GHCR, then SSH into the EC2 test instance (13.209.88.203) and restart the stack via run-registry.sh. Use whenever the user wants to deploy or redeploy a new build of ego-flow-server to the remote test server.
---

# /deploy — EgoFlow EC2 배포 스킬

`docs/14. test_guide.md`에 정리된 **host build → GHCR push → EC2 pull + restart** 흐름을 한 번에 실행한다. 서버에서 직접 빌드하면 OOM으로 인스턴스가 죽기 때문에, 빌드는 반드시 host PC에서 수행한다.

## 인자 파싱

호출 형태: `/deploy [tag] [server-only] [--no-pull]`

- 인자 없음 → `IMAGE_TAG=latest`, 전체 흐름(빌드 + 배포) 수행
- 첫 인자가 `latest`가 아닌 토큰 → 그 값을 `IMAGE_TAG`로 사용 (예: `main-20260530`)
- `server-only` 포함 → host 빌드 스킵, EC2에서 `run-registry.sh up`만 다시 수행 (이미 GHCR에 이미지가 있을 때)
- `--no-pull` 포함 → 서버에서 `git pull --ff-only` 스킵 (런타임 파일이 안 바뀐 경우)

인자가 모호하면 짧게 한 번 물어본다.

## 사전 점검 (실행 전)

다음을 한 번에 병렬로 확인하고, 실패 시 진행을 멈추고 사용자에게 무엇이 부족한지 알린다.

```bash
pwd                              # /home/dennis0405/ego-flow/ego-flow-server 인지 확인
test -x ./scripts/build-registry-images.sh
test -x ./scripts/run-registry.sh
docker info >/dev/null
gh auth status
test -f ~/.ssh/egoflow-server.pem
```

`~/.ssh/egoflow-server.pem` 권한이 600이 아니면 `chmod 600 ~/.ssh/egoflow-server.pem`을 먼저 권한 받아 실행한다.

## 사용자 확인

배포는 잠시 stack을 내렸다가 다시 띄우므로 visible side effect다. 다음을 사용자에게 보여주고 동의를 받은 뒤 진행한다(이미 같은 호출 안에서 명시적으로 승인한 경우 생략):

- 사용할 tag
- 실행할 단계 (빌드 yes/no, git pull yes/no)
- 영향: `13.209.88.203`의 운영 stack이 재기동됨

## Step 1 — Host build & GHCR push

`server-only`가 없을 때만 실행. 반드시 repo 루트에서 실행:

```bash
./scripts/build-registry-images.sh \
    --login \
    --tag <TAG> \
    --no-latest \
    --public-origin http://13.209.88.203 \
    --vite-api-base-url /api/v1 \
    --vite-backend-origin http://13.209.88.203
```

- `<TAG>`를 파싱된 tag로 치환한다.
- 빌드는 길어질 수 있으므로 Bash 호출 시 timeout을 600000(10분)으로 설정.
- `--login`이 `gh auth token | docker login ghcr.io` 까지 수행하므로 별도 로그인은 불필요.
- 빌드 종료 후 push된 이미지 3개의 full reference(`ghcr.io/dennis0405/ego-flow-server-{backend,worker,dashboard}:<TAG>`)를 사용자에게 보고한다.
- `gh auth token`이 실패하거나 push가 `denied`로 떨어지면 멈추고 `gh auth login --scopes write:packages` 안내.

## Step 2 — EC2 stack 재기동

interactive shell로 들어가지 말고, 단일 SSH 명령으로 처리:

```bash
ssh -i ~/.ssh/egoflow-server.pem -o StrictHostKeyChecking=accept-new ubuntu@13.209.88.203 \
  "set -e; cd ~/ego-flow-server && git pull --ff-only && IMAGE_TAG=<TAG> ./scripts/run-registry.sh up"
```

- `--no-pull`이 주어졌으면 `git pull --ff-only && ` 부분을 빼고 보낸다.
- `<TAG>`는 Step 1과 동일해야 한다.
- `run-registry.sh up`은 자체적으로 `docker pull` → compose up → bind-mount config 변경 서비스 restart → healthy 대기를 수행한다. 출력은 그대로 사용자에게 노출 (서비스별 healthy/running 로그가 핵심 시그널).
- 이 SSH 호출도 timeout 600000으로 설정.

### Step 2 실패 처리

- `docker pull` 단계에서 `denied: denied` 또는 `unauthorized` → EC2가 GHCR에 미인증. 다음을 1회 수행 후 Step 2 재시도:

  ```bash
  ssh -i ~/.ssh/egoflow-server.pem ubuntu@13.209.88.203 \
    "gh auth token | docker login ghcr.io -u dennis0405 --password-stdin"
  ```

- `wait_for_healthy <service>` 단계에서 timeout → 해당 서비스 로그를 받아 사용자에게 노출:

  ```bash
  ssh -i ~/.ssh/egoflow-server.pem ubuntu@13.209.88.203 \
    "cd ~/ego-flow-server && ./scripts/run-registry.sh logs <service> --no-color 2>/dev/null | tail -80"
  ```

- **절대 금지**: EC2에서 `./scripts/run.sh up`을 권하지 않는다. 그 경로는 build 단계에서 OOM을 유발해 인스턴스를 죽인다(`docs/14. test_guide.md` §1.1 / §4.3).

## Step 3 — Smoke check

host PC에서:

```bash
curl -fsS http://13.209.88.203/api/v1/health
curl -fsSI http://13.209.88.203/ | head -1
curl -fsSI http://13.209.88.203/api-docs | head -1
```

세 결과를 한 번에 보고. 하나라도 실패면 backend 로그 tail까지 함께 노출.

## 최종 보고 포맷

10줄 이내로:

1. 사용 tag
2. push된 이미지 3개 (full ref)
3. EC2에서 healthy로 올라간 서비스 목록
4. smoke check 3종 결과 (OK/FAIL)
5. 후속 확인 URL: `http://13.209.88.203` (dashboard), `http://13.209.88.203/api-docs`

## 참고

- 더 자세한 컨텍스트(보안 그룹 포트, RTMP/WHIP 엔드포인트, 트러블슈팅 표)는 `docs/14. test_guide.md` 참고.
- SSH key 위치, EC2 IP, GHCR owner 등은 모두 위 절차에 하드코딩되어 있다. 환경이 바뀌면 이 스킬과 `docs/14. test_guide.md`를 함께 갱신한다.
