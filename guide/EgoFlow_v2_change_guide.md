# EgoFlow — v2 변경 가이드

> 기존 PoC 코드베이스에 대한 3가지 변경 사항을 정의한다.
> 이 문서는 AI 코딩 에이전트(Claude Code, Codex CLI)가 변경을 구현할 때 참조하는 스펙 문서이다.
>
> 현재 코드베이스 설계는 `EgoFlow_IMPLEMENTATION_GUIDE.md`를 참조한다.

---

## 변경 요약

| # | 변경 | 영향 범위 |
|---|---|---|
| 1 | Admin 비밀번호 영속화 | seed 로직, 환경변수 처리 |
| 2 | Repository 계층 도입 (video_key → repository) | DB 스키마, 스토리지 구조, 파일명, 스트림 흐름, API, Dashboard, App 연동 |
| 3 | Repository 기반 접근 권한 체계 | DB 스키마, 미들웨어, API, Dashboard |

---

## 변경 1: Admin 비밀번호 영속화

### 현재 동작

`prisma/seed.ts`에서 `ADMIN_DEFAULT_PASSWORD` 환경변수를 읽어 admin 계정을 `upsert`한다. 서버를 내렸다 다시 띄울 때 seed가 재실행되면, admin이 Dashboard에서 변경한 비밀번호가 환경변수 값으로 덮어씌워질 수 있다.

### 변경 후 동작

Admin 계정이 DB에 **이미 존재하면 비밀번호를 건드리지 않는다**. 최초 1회만 환경변수로 비밀번호를 설정하고, 이후에는 admin이 직접 변경한 비밀번호가 영구 유지된다.

### 구현 방법

`prisma/seed.ts`의 admin upsert 로직을 변경한다:

```typescript
// 변경 전 (현재)
await prisma.user.upsert({
  where: { id: 'admin' },
  update: { passwordHash: await bcrypt.hash(adminPassword, 12) }, // ← 매번 덮어씀
  create: { id: 'admin', passwordHash: await bcrypt.hash(adminPassword, 12), role: 'admin', ... },
});

// 변경 후
const existing = await prisma.user.findUnique({ where: { id: 'admin' } });
if (!existing) {
  // 최초 생성 시에만 환경변수 비밀번호 사용
  await prisma.user.create({
    data: {
      id: 'admin',
      passwordHash: await bcrypt.hash(adminPassword, 12),
      role: 'admin',
      displayName: 'Administrator',
      isActive: true,
    },
  });
} else {
  // 이미 존재하면 비밀번호 제외 다른 필드만 필요 시 업데이트
  // passwordHash는 절대 건드리지 않음
}
```

### 비밀번호 변경 경로

| 경로 | 설명 |
|---|---|
| 최초 부팅 (Admin) | `ADMIN_DEFAULT_PASSWORD` 환경변수로 admin 계정 생성 |
| User 계정 생성 | Admin이 Dashboard에서 id + 비밀번호를 지정하여 생성 |
| 비밀번호 변경 | 모든 사용자(admin 포함)가 Dashboard **Profile 탭**에서 현재 비밀번호 입력 → 새 비밀번호 설정 (`PUT /api/v1/users/me/password`) |
| 서버 재기동 | DB에 저장된 비밀번호 유지 (seed가 덮어쓰지 않음) |

### 영향 파일

```
backend/prisma/seed.ts          # upsert → findUnique + create 분기
frontend/src/routes/profile/    # 비밀번호 변경 UI
```

---

## 변경 2: Repository 계층 도입

### 개념

기존 `video_key`를 **Repository** 개념으로 대체한다. Repository는 GitHub/HuggingFace의 repository와 유사한 데이터셋 컨테이너이다.

| 기존 | 변경 후 |
|---|---|
| `video_key`는 파일명 prefix | **Repository**는 독립 엔티티 (DB 테이블) |
| 영상 저장: `{target_dir}/{user_id}/vlm/{video_key}_{id8}.mp4` | 영상 저장: `{target_dir}/{user_id}/{repository_name}/{uuid}.mp4` |
| video_key는 스트림 등록 시 자유 텍스트로 지정 | Repository는 Dashboard에서 사전 생성, App에서 선택형으로 지정 |
| 접근 권한: user_id 기반 (본인 데이터만) | 접근 권한: Repository 단위 (public/private + role 기반) |

### DB 스키마 변경

#### 새 테이블: `repositories`

```prisma
enum RepoVisibility {
  public
  private
}

model Repository {
  id          String         @id @default(uuid()) @db.Uuid
  name        String         @db.VarChar(64)          // [a-z0-9_-], RTMP path로도 사용
  ownerId     String         @map("owner_id") @db.VarChar(64)
  visibility  RepoVisibility @default(public)
  description String?        @db.VarChar(500)
  createdAt   DateTime       @default(now()) @map("created_at")
  updatedAt   DateTime       @updatedAt @map("updated_at")

  @@unique([ownerId, name])                            // 같은 owner 내에서 name 유일
  @@index([ownerId], map: "idx_repos_owner_id")
  @@index([visibility], map: "idx_repos_visibility")
  @@map("repositories")
}
```

> **역참조 relation(`videos Video[]`, `members RepoMember[]`) 은 Repository 모델에 선언하지 않는다.** 특정 repo의 영상이나 멤버가 필요할 때는 서비스 로직에서 `prisma.video.findMany({ where: { repositoryId } })`, `prisma.repoMember.findMany({ where: { repositoryId } })` 로 명시적으로 조회한다.

#### 새 테이블: `repo_members` (권한 매핑)

`repository_id + user_id` 조합으로 어떤 사용자가 어떤 repo에 어떤 권한을 가지는지 저장하는 독립 매핑 테이블이다.

```prisma
enum RepoRole {
  read
  maintain
  admin
}

model RepoMember {
  id           String     @id @default(uuid()) @db.Uuid
  repositoryId String     @map("repository_id") @db.Uuid
  userId       String     @map("user_id") @db.VarChar(64)
  role         RepoRole
  createdAt    DateTime   @default(now()) @map("created_at")

  @@unique([repositoryId, userId])                     // 한 repo에 한 user는 하나의 role만
  @@index([repositoryId], map: "idx_repo_members_repo_id")
  @@index([userId], map: "idx_repo_members_user_id")
  @@map("repo_members")
}
```

> **RepoMember 모델에도 `repository Repository` 나 `user User` 역참조를 선언하지 않는다.** 권한 확인 시 서비스 로직에서 `prisma.repoMember.findUnique({ where: { repositoryId_userId: { repositoryId, userId } } })` 로 직접 조회한다.

#### `videos` 테이블 변경

```diff
model Video {
-  videoKey              String      @map("video_key") @db.VarChar(64)
-  userId                String      @map("user_id") @db.VarChar(64)
-  user                  User        @relation(fields: [userId], references: [id])
+  repositoryId          String      @map("repository_id") @db.Uuid

   // ... 나머지 필드 동일

-  @@index([videoKey], map: "idx_videos_video_key")
-  @@index([userId], map: "idx_videos_user_id")
+  @@index([repositoryId], map: "idx_videos_repository_id")
}
```

> Video 모델에도 `repository Repository` 역참조를 선언하지 않는다. Video가 속한 repo 정보가 필요하면 `prisma.repository.findUnique({ where: { id: video.repositoryId } })` 로 조회한다.

#### `User` 모델 — 변경 없음

```prisma
model User {
  id           String   @id @db.VarChar(64)
  passwordHash String   @map("password_hash") @db.VarChar(255)
  role         UserRole @default(user)
  isActive     Boolean  @default(true) @map("is_active")
  displayName  String?  @map("display_name") @db.VarChar(255)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  @@map("users")
}
```

> User 모델에 `ownedRepos`, `repoMembers`, `videos` 등의 역참조를 추가하지 않는다. 특정 user의 repo 목록이나 권한을 확인할 때는 `repo_members` 테이블을 직접 스캔한다.

#### 서비스 로직에서의 권한 확인 패턴

```typescript
// 예: 특정 user가 특정 repo에 대해 어떤 권한을 가지는지 확인
async function getUserRepoRole(userId: string, repositoryId: string): Promise<RepoRole | null> {
  const member = await prisma.repoMember.findUnique({
    where: { repositoryId_userId: { repositoryId, userId } },
  });
  return member?.role ?? null;
}

// 예: 특정 repo의 모든 멤버 조회
async function getRepoMembers(repositoryId: string) {
  return prisma.repoMember.findMany({
    where: { repositoryId },
  });
}

// 예: 특정 user가 접근 가능한 repo 목록
async function getAccessibleRepos(userId: string, userRole: UserRole) {
  if (userRole === 'admin') {
    // 시스템 Admin은 모든 repo 접근 가능
    return prisma.repository.findMany();
  }

  // 1. 내가 멤버인 repo
  const memberships = await prisma.repoMember.findMany({
    where: { userId },
    select: { repositoryId: true },
  });
  const memberRepoIds = memberships.map(m => m.repositoryId);

  // 2. public repo + 내가 멤버인 repo
  return prisma.repository.findMany({
    where: {
      OR: [
        { visibility: 'public' },
        { id: { in: memberRepoIds } },
      ],
    },
  });
}
```

### 스토리지 구조 변경

```
# 기존
{target_dir}/{user_id}/vlm/{video_key}_{id8}.mp4
{target_dir}/{user_id}/dashboard/{video_key}_{id8}.mp4
{target_dir}/{user_id}/thumbnails/{video_key}_{id8}.jpg

# 변경 후
{target_dir}/{owner_id}/{repo_name}/{video_uuid}.mp4              # 원본 (VLM용)
{target_dir}/{owner_id}/{repo_name}/.dashboard/{video_uuid}.mp4   # Dashboard 재생용
{target_dir}/{owner_id}/{repo_name}/.thumbnails/{video_uuid}.jpg  # 썸네일
```

**변경 포인트:**
- `vlm/`, `dashboard/`, `thumbnails/` 최상위 분리 → Repository 디렉토리 안에 통합
- VLM용 영상이 repository 루트에 직접 위치 (Python Library에서 glob 시 `{repo_path}/*.mp4`로 간단히 접근)
- Dashboard/Thumbnail은 dot-prefix(`.dashboard/`, `.thumbnails/`)로 숨김 처리하여 VLM용 파일과 구분
- 파일명에서 `video_key` prefix 제거 → UUID만 사용 (`{video_uuid}.mp4`)
- Repository name이 디렉토리명 역할을 하므로 파일명에 중복 포함할 필요 없음

### 스트림 등록 흐름 변경

```
# 기존
App → POST /streams/register { video_key, device_type }
→ video_key는 자유 텍스트

# 변경 후
App → GET /api/v1/repositories/mine      ← 내가 maintain/admin 권한을 가진 repo 목록
App → POST /streams/register { repository_id, device_type }
→ repository_id는 사전 생성된 repository의 UUID
→ Backend가 해당 repo에 대한 maintain 이상 권한 확인
→ RTMP path는 repository name 사용: rtmp://.../live/{repo_name}
→ Redis 세션에 repository_id 저장
```

### MediaMTX RTMP path

```
# 기존
rtmp://<host>:1935/live/{video_key}

# 변경 후
rtmp://<host>:1935/live/{repo_name}
```

- repo_name이 RTMP path로 사용된다.
- 동시에 같은 repo_name으로 두 사용자가 스트리밍하면 충돌 → 세션 등록 시 활성 스트림 체크로 방지.

### API 변경 요약

#### 새 API

| Method | Path | 설명 |
|---|---|---|
| `POST` | `/api/v1/repositories` | Repository 생성 (모든 인증된 사용자) |
| `GET` | `/api/v1/repositories` | Repository 목록 (접근 가능한 것만) |
| `GET` | `/api/v1/repositories/:repoId` | Repository 상세 |
| `PATCH` | `/api/v1/repositories/:repoId` | Repository 설정 변경 (name, visibility, description) — repo admin만 |
| `DELETE` | `/api/v1/repositories/:repoId` | Repository 삭제 — repo admin만 |
| `GET` | `/api/v1/repositories/:repoId/members` | 멤버 목록 — repo admin만 |
| `POST` | `/api/v1/repositories/:repoId/members` | 멤버 추가/권한 부여 — repo admin만 |
| `PATCH` | `/api/v1/repositories/:repoId/members/:userId` | 멤버 권한 변경 — repo admin만 |
| `DELETE` | `/api/v1/repositories/:repoId/members/:userId` | 멤버 제거 — repo admin만 |
| `GET` | `/api/v1/repositories/mine` | 내가 권한을 가진 repo 목록 (App 선택형 UI용) |

#### 변경 API

| Method | Path | 변경 내용 |
|---|---|---|
| `POST` | `/streams/register` | `video_key` → `repository_id`로 변경. 권한 확인(maintain 이상) 추가 |
| `GET` | `/videos` | `video_key` 필터 → `repository_id` 필터로 변경. 권한 확인 추가 |
| `GET` | `/videos/:id` | Repository 기반 접근 권한 확인 |
| `DELETE` | `/videos/:id` | Repository maintain 이상 권한 확인 |
| `POST` | `/hooks/recording-complete` | Redis 세션에서 repository_id 조회, Video에 repository_id 저장 |

#### 제거/변경되는 개념

- `video_key` 개념 → `repository.name`으로 대체
- `Video.userId` 직접 참조 → `Video.repositoryId → Repository.ownerId`로 간접 참조
- 사용자별 데이터 격리 → Repository 권한 기반 접근 제어

### Worker 변경

```typescript
// 기존 경로 계산
const userDir = `${targetDirectory}/${userId}`;
const fileName = `${videoKey}_${videoIdShort}`;
const vlmPath = `${userDir}/vlm/${fileName}.mp4`;

// 변경 후
const repoDir = `${targetDirectory}/${ownerId}/${repoName}`;
const videoFileName = `${videoId}`;  // UUID 전체 사용
const vlmPath = `${repoDir}/${videoFileName}.mp4`;
const dashboardPath = `${repoDir}/.dashboard/${videoFileName}.mp4`;
const thumbnailPath = `${repoDir}/.thumbnails/${videoFileName}.jpg`;
```

Job data에 `repositoryId`, `ownerId`, `repoName`이 포함되어야 한다.

### Dashboard 변경

| 화면 | 변경 내용 |
|---|---|
| 메인 (로그인 후) | 기존: 영상 목록 바로 표시 → 변경: **Repository 목록** 표시 (`{owner_id}/{repo_name}` 형태 패널) |
| Repository 상세 | 기존: 없음 → 변경: 해당 repo의 영상 목록 + repo 설정 + 멤버 관리 |
| 영상 목록 | 기존: 전체 영상 필터 → 변경: 특정 repository 내 영상 목록 |
| Repository 생성 | 새 페이지/모달: name, visibility, description 입력 |
| 멤버 관리 | repo admin만 접근: 멤버 추가, 권한 변경, 제거 |

### Dashboard 라우트 변경

```
# 기존
/videos                     → 영상 목록
/videos/:videoId            → 영상 상세

# 변경 후
/repositories               → Repository 목록 (메인)
/repositories/new           → Repository 생성
/repositories/:repoId       → Repository 상세 (영상 목록)
/repositories/:repoId/settings  → Repository 설정 + 멤버 관리
/repositories/:repoId/videos/:videoId  → 영상 상세
```

---

## 변경 3: Repository 기반 접근 권한 체계

### 권한 모델

```
시스템 Admin (전역)
  └── 모든 Repository에 대해 암묵적 admin 권한
      (DB에 RepoMember 없어도 모든 조작 가능)

Repository Owner (생성자)
  └── 해당 Repository의 RepoMember로 role=admin 자동 추가

RepoMember (명시적 부여)
  ├── admin:    repo 삭제, 설정 변경, 멤버 관리, 데이터 추가/삭제, 읽기
  ├── maintain: 데이터 추가/삭제, 읽기 (= 스트리밍으로 영상 추가 가능)
  └── read:     읽기만 (영상 조회, 재생, 다운로드)

Public Repository
  └── 모든 인증된 사용자에게 암묵적 read 권한

Private Repository
  └── RepoMember에 등록된 사용자만 접근 가능
```

### 권한 매트릭스

| 동작 | 시스템 Admin | Repo admin | Repo maintain | Repo read | Public 비멤버 | Private 비멤버 |
|---|---|---|---|---|---|---|
| Repository 보기 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 영상 목록/상세/재생 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 스트리밍 (영상 추가) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 영상 삭제 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Repo 설정 변경 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Repo 삭제 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 멤버 관리 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### 권한 확인 미들웨어

새 미들웨어 `repo-access.middleware.ts`를 생성한다:

```typescript
// 사용 예시
router.get('/repositories/:repoId/videos',
  authenticate,                              // JWT 검증
  repoAccess({ minRole: 'read' }),           // repo 접근 권한 확인
  videosController.list
);

router.post('/streams/register',
  authenticate,
  // body에서 repository_id 추출 후 maintain 이상 확인
  repoAccess({ minRole: 'maintain', repoIdFrom: 'body.repository_id' }),
  streamsController.register
);
```

**`repoAccess` 미들웨어 로직:**

```
1. repoId를 path param 또는 body에서 추출
2. Repository 조회 (없으면 404)
3. 현재 사용자가 시스템 Admin이면 → 통과
4. repo_members에서 현재 사용자의 role 조회
5. 멤버가 아니고 repo가 public이면 → read 권한으로 간주
6. 멤버가 아니고 repo가 private이면 → 403
7. 멤버의 role이 minRole 이상이면 → 통과
8. 아니면 → 403
```

**Role 계층:** `admin > maintain > read`

### 시스템 Admin의 암묵적 권한

시스템 Admin(`users.role = 'admin'`)은 **모든 Repository에 대해 RepoMember 레코드 없이도 admin 권한**을 가진다. 이는 미들웨어에서 사용자 role 체크로 처리하며, DB에 명시적 RepoMember를 생성하지 않는다.

### Repository 생성 시 자동 권한 부여

```typescript
// POST /api/v1/repositories
async function createRepository(userId, data) {
  const repo = await prisma.repository.create({
    data: {
      name: data.name,
      ownerId: userId,
      visibility: data.visibility || 'private',
      description: data.description,
    },
  });

  // 생성자에게 자동으로 admin 권한 부여
  await prisma.repoMember.create({
    data: {
      repositoryId: repo.id,
      userId: userId,
      role: 'admin',
    },
  });

  return repo;
}
```

---

## 마이그레이션 전략

기존 데이터를 보존하지 않고 **클린 리셋**한다. 모든 기존 데이터(DB, 파일, 캐시)를 삭제하고 새 스키마로 처음부터 시작한다.

### 리셋 절차

```bash
# 1. 서비스 중지
docker compose down

# 2. 모든 데이터 삭제
rm -rf data/raw/*                    # MediaMTX raw recordings
rm -rf data/datasets/*               # generated files (target_directory)
rm -rf data/redis/*                  # Redis 영속 데이터

# 3. PostgreSQL 볼륨 삭제 (DB 완전 초기화)
docker volume rm egoflow_pgdata      # 또는 docker compose down -v

# 4. Prisma 마이그레이션 리셋 + 새 스키마 적용
cd backend
npx prisma migrate reset --force     # 기존 마이그레이션 전부 삭제 후 재생성
npx prisma migrate dev --name v2-repositories

# 5. 서비스 재기동 (seed 자동 실행 → admin 계정 + 기본 settings 생성)
docker compose up -d
```

### 배포 환경 (EC2) 적용

EC2 인스턴스에서도 동일하게 클린 리셋한다:

```bash
# EC2 접속 후
cd /path/to/deploy
docker compose down -v               # 서비스 중지 + 볼륨 삭제
rm -rf data/raw/* data/datasets/* data/redis/*
docker compose up -d                 # 새 이미지로 재기동
```

> 기존에 저장되어 있던 영상 데이터, DB 레코드, Redis 세션 모두 삭제된다. PoC 단계이므로 데이터 보존 마이그레이션은 수행하지 않는다.

---

## 영향받는 파일 목록

### Backend

```
# 새로 생성
backend/src/routes/repositories.routes.ts
backend/src/services/repository.service.ts
backend/src/schemas/repository.schema.ts
backend/src/middleware/repo-access.middleware.ts

# 수정
backend/prisma/schema.prisma                  # Repository, RepoMember 모델 추가, Video 변경
backend/prisma/seed.ts                        # Admin 비밀번호 영속화 로직
backend/src/config/env.ts                     # ADMIN_FORCE_RESET_PASSWORD 추가
backend/src/routes/streams.routes.ts          # video_key → repository_id
backend/src/services/stream.service.ts        # Redis 세션에 repository 정보 저장
backend/src/routes/videos.routes.ts           # 필터 변경, 권한 확인 추가
backend/src/services/video.service.ts         # repository 기반 쿼리
backend/src/routes/hooks.routes.ts            # repository_id 저장
backend/src/workers/video-processing.worker.ts # 경로 계산 로직 변경
backend/src/workers/encoding.ts               # 출력 경로 변경
backend/src/lib/storage.ts                    # 파일 URL 계산 변경
backend/src/middleware/file-access.middleware.ts # repository 권한 기반 접근 제어
backend/src/schemas/stream.schema.ts          # video_key → repository_id
backend/src/schemas/video.schema.ts           # 필터 변경
```

### Frontend (Dashboard)

```
# 새로 생성
frontend/src/routes/repositories/             # 라우트 파일들
frontend/src/api/repositories.ts              # API 클라이언트
frontend/src/components/RepoCard.tsx
frontend/src/components/MemberManager.tsx

# 수정
frontend/src/routes/                          # 라우트 구조 재편
frontend/src/api/videos.ts                    # repository 기반 조회
frontend/src/api/streams.ts                   # repository_id 전달
frontend/src/components/                      # UI 컴포넌트 수정
```

---

## 구현 순서 권장

```
Phase A-0: Admin 비밀번호 영속화
  → seed.ts 수정만으로 완료. 독립적이라 먼저 처리.

Phase A-1: EC2 클린 리셋 (기존 데이터 전체 삭제)
  → DB, 파일, Redis 전부 초기화. 새 스키마를 적용하기 전에 반드시 수행.
  → AI 에이전트가 SSH 접속이 어려운 경우, 아래 가이드를 사용자에게 제시하여 직접 수행하도록 한다.

Phase B: DB 스키마 변경
  → Repository, RepoMember 모델 추가
  → Video 모델 변경 (repository_id)
  → prisma migrate reset --force → 새 마이그레이션 생성

Phase C: Repository CRUD API
  → routes, services, schemas 생성
  → repo-access 미들웨어 생성

Phase D: 기존 API 수정
  → streams (video_key → repository_id)
  → hooks (repository_id 저장)
  → videos (repository 기반 필터/권한)
  → worker (경로 변경)
  → file-access (repository 권한)

Phase E: Dashboard 수정
  → Repository 목록/상세/생성 페이지
  → 영상 목록을 repository 내부로 이동
  → 멤버 관리 UI
  → 라우트 구조 재편
```

### Phase A-1: EC2 클린 리셋 가이드

AI 에이전트가 SSH 접속이 불가한 경우, 사용자에게 클린 리셋 가이드를 제시한다.

**에이전트 지침:** 가이드를 생성하기 전에 반드시 아래 파일들을 읽어서 실제 배포 환경의 경로, 볼륨 이름, 서비스 구성을 확인한 후, 그에 맞는 정확한 커맨드를 생성하라.

```
참조할 파일:
- deploy/ec2/docker-compose.yml      # 배포용 compose: 볼륨 이름, 서비스 이름, data 마운트 경로
- deploy/ec2/mediamtx.yml            # recordPath 설정 (raw 파일 저장 경로)
- deploy/ec2/deploy.sh               # 배포 스크립트 (작업 디렉토리, 이미지 태그 등)
- deploy/ec2/README.md               # 배포 가이드 (SSH 접속 방법, 경로 등)
- docker-compose.yml                 # 로컬 개발용 compose (비교 참조)
```

가이드에는 다음 항목을 포함한다:
1. SSH 접속 커맨드 (deploy 문서에 기재된 host/key 정보 기반)
2. 배포 디렉토리로 이동
3. `docker compose down` (실제 compose 파일명/경로에 맞게)
4. PostgreSQL 볼륨 삭제 (실제 볼륨 이름에 맞게)
5. data 디렉토리 삭제 (실제 마운트 경로에 맞게 — raw, datasets, redis 등)
6. 빈 디렉토리 재생성
7. 삭제 확인 커맨드

이후 Phase B에서 새 스키마가 적용된 이미지를 배포하고 서비스를 재기동하면, seed가 실행되어 admin 계정과 기본 settings가 자동 생성된다.

---

*이 문서는 EgoFlow v2 변경 사항을 정의하며, 구현 시 `EgoFlow_IMPLEMENTATION_GUIDE.md`와 함께 참조한다.*