# EgoFlow — API 명세

> 모든 엔드포인트의 요청/응답 스키마, 에러 코드, 유효성 검증 규칙, 엣지 케이스를 정의한다.
>
> Base URL: `/api/v1`

---

## 공통 사항

### 인증

인증이 필요한 엔드포인트는 요청 헤더에 JWT를 포함해야 한다:

```
Authorization: Bearer {jwt_token}
```

토큰 잔여 유효 시간이 6시간 미만이면 응답 헤더에 갱신 토큰이 포함된다:

```
X-Refreshed-Token: {new_jwt_token}
```

### 공통 에러 응답

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "사람이 읽을 수 있는 에러 설명"
  }
}
```

### 공통 에러 코드

| HTTP | 코드 | 설명 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 요청 파라미터 유효성 검증 실패. `details` 필드에 Zod 에러 포함 |
| 401 | `UNAUTHORIZED` | 토큰 없음 또는 만료 |
| 401 | `INVALID_CREDENTIALS` | 로그인 실패 (id 또는 pw 불일치) |
| 403 | `FORBIDDEN` | 권한 없음 (역할 부족 또는 타인 데이터 접근) |
| 404 | `NOT_FOUND` | 리소스 없음 |
| 409 | `CONFLICT` | 리소스 충돌 (이미 존재 등) |
| 500 | `INTERNAL_ERROR` | 서버 내부 오류 |

---

## 1. 인증 (Auth)

### 1.1 POST /auth/login

로그인하여 JWT 토큰을 발급받는다.

**인증:** 불필요

**Request Body:**
```json
{
  "id": "string (1~64자, 필수)",
  "password": "string (1~255자, 필수)"
}
```

**Zod 스키마:**
```typescript
z.object({
  id: z.string().min(1).max(64),
  password: z.string().min(1).max(255),
})
```

**200 OK:**
```json
{
  "token": "eyJ...",
  "user": {
    "id": "alice",
    "role": "user",
    "displayName": "Alice Kim"
  }
}
```

**에러:**

| HTTP | 코드 | 조건 |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | id가 존재하지 않거나, password가 불일치 |
| 400 | `VALIDATION_ERROR` | id 또는 password 누락/형식 오류 |

**엣지 케이스:**
- 비활성화된 계정으로 로그인 시도 → `INVALID_CREDENTIALS` (존재 여부를 노출하지 않음)

---

### 1.2 POST /auth/rtmp

MediaMTX External HTTP Auth 전용. MediaMTX가 RTMP 퍼블리시/읽기 요청 시 자동 호출한다. 클라이언트가 직접 호출하지 않는다.

**인증:** 불필요 (MediaMTX 내부 호출)

**Request Body (MediaMTX 전송 형식):**
```json
{
  "user": "alice",
  "password": "eyJ...(jwt)",
  "ip": "192.168.1.10",
  "action": "publish",
  "path": "live/cooking_pasta",
  "protocol": "rtmp",
  "id": "connection-uuid",
  "query": "user=alice&pass=eyJ..."
}
```

**200 OK:** 인증 성공 (빈 body)

**401 Unauthorized:** 인증 실패 (빈 body)

**검증 로직:**
1. `password` 필드에서 JWT 추출 및 검증
2. JWT의 `userId`와 `user` 필드 일치 확인
3. `action`이 `publish`이면 허용, 그 외(`read`, `playback`)도 JWT가 유효하면 허용

**엣지 케이스:**
- `user`와 `password`가 빈 문자열 → 401 (RTSP 클라이언트가 초기 인증 없이 접속할 때 발생, 정상 동작)
- JWT가 만료된 상태 → 401 (App이 재로그인 필요)

---

## 2. 스트리밍 세션 (Streams)

### 2.1 POST /streams/register

RTMP 퍼블리시 전에 스트림 세션을 등록한다. video_key와 사용자를 바인딩하고 RTMP URL을 반환한다.

**인증:** 필수

**Request Body:**
```json
{
  "video_key": "string (1~64자, [a-z0-9_]만 허용, 필수)",
  "device_type": "string (최대 100자, 선택)"
}
```

**Zod 스키마:**
```typescript
z.object({
  video_key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  device_type: z.string().max(100).optional(),
})
```

**200 OK:**
```json
{
  "video_key": "cooking_pasta",
  "rtmp_url": "rtmp://192.168.1.100:1935/live/cooking_pasta",
  "status": "ready"
}
```

**에러:**

| HTTP | 코드 | 조건 |
|---|---|---|
| 409 | `CONFLICT` | 해당 `user_id + video_key` 조합으로 이미 활성 세션이 존재 |
| 400 | `VALIDATION_ERROR` | video_key 형식 불일치 (`[a-z0-9_]` 위반, 길이 초과 등) |

**Backend 내부 동작:**
1. DB settings에서 `target_directory` 조회
2. Redis에 세션 저장: key=`stream:{userId}:{video_key}`, value=`{ userId, targetDirectory, deviceType, registeredAt }`, TTL=24시간
3. RTMP URL 생성하여 반환

**엣지 케이스:**
- 같은 사용자가 같은 video_key로 재등록 → 기존 세션 덮어쓰기 (RTMP disconnect 없이 재시작하는 경우 대비)
- 다른 사용자가 같은 video_key로 등록 → **허용** (video_key는 user별 격리, 같은 key라도 다른 user면 충돌 아님)

---

### 2.2 GET /streams/active

현재 활성 중인 스트림 세션 목록을 조회한다.

**인증:** 필수

**Query Parameters:** 없음

**200 OK:**
```json
{
  "streams": [
    {
      "video_key": "cooking_pasta",
      "user_id": "alice",
      "device_type": "rayban_meta_v2",
      "hls_url": "http://192.168.1.100:8888/live/cooking_pasta/index.m3u8",
      "registered_at": "2026-03-14T09:30:00Z"
    }
  ]
}
```

**권한:**
- 일반 User: 본인 세션만 반환
- Admin: 전체 세션 반환

**엣지 케이스:**
- 활성 세션 없음 → `{ "streams": [] }`
- Redis에 세션이 있지만 MediaMTX에서 실제 스트리밍이 끊긴 경우 → TTL 만료로 자동 정리

---

## 3. Webhook (Hooks)

### 3.1 POST /hooks/recording-complete

MediaMTX `runOnDisconnect`에서 호출. 스트림 종료 시 레코딩 완료를 알린다.

**인증:** 불필요 (서버 내부 호출, 로컬호스트만 허용 권장)

**Request Body:**
```json
{
  "path": "live/cooking_pasta",
  "recording_path": "./recordings/live/cooking_pasta/2026-03-14_09-30-00.mp4"
}
```

**Zod 스키마:**
```typescript
z.object({
  path: z.string().min(1),
  recording_path: z.string().min(1),
})
```

**200 OK:**
```json
{
  "video_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PENDING"
}
```

**Backend 내부 동작:**
1. `path`에서 video_key 파싱 (`"live/cooking_pasta"` → `"cooking_pasta"`)
2. Redis에서 `stream:*:{video_key}` 패턴으로 세션 조회 → `userId`, `targetDirectory` 획득
3. DB에 Video 레코드 생성 (`status: PENDING`)
4. BullMQ에 Job enqueue: `{ videoId, videoKey, userId, rawRecordingPath, targetDirectory }`
5. Redis 세션 삭제

**에러:**

| HTTP | 코드 | 조건 |
|---|---|---|
| 404 | `NOT_FOUND` | 해당 video_key에 대한 세션이 Redis에 없음 (세션 등록 없이 스트리밍했거나 TTL 만료) |
| 400 | `VALIDATION_ERROR` | path 또는 recording_path 누락 |

**엣지 케이스:**
- 세션이 TTL 만료로 사라진 경우 → 404. 이 경우 Raw 파일은 남아있으므로 수동 처리가 필요할 수 있음
- 같은 recording_path로 중복 webhook → DB에 이미 해당 raw_recording_path가 있으면 무시 (idempotent)
- recording_path의 파일이 아직 쓰기 중일 수 있음 → Worker에서 파일 크기 안정화를 확인 후 처리 시작

---

## 4. 영상 (Videos)

### 4.1 GET /videos

영상 목록을 조회한다. 필터링, 페이지네이션, 정렬을 지원한다.

**인증:** 필수

**Query Parameters:**

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `video_key` | string | — | video_key로 필터 (정확 일치) |
| `status` | enum | — | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `user_id` | string | — | Admin 전용. 특정 사용자 필터 |
| `page` | int | 1 | 페이지 번호 (1-based) |
| `limit` | int | 20 | 페이지당 항목 수 (최대 100) |
| `sort_by` | string | `created_at` | 정렬 기준: `created_at`, `recorded_at`, `duration_sec` |
| `sort_order` | string | `desc` | `asc` 또는 `desc` |

**Zod 스키마:**
```typescript
z.object({
  video_key: z.string().max(64).regex(/^[a-z0-9_]+$/).optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
  user_id: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort_by: z.enum(['created_at', 'recorded_at', 'duration_sec']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
})
```

**200 OK:**
```json
{
  "total": 42,
  "page": 1,
  "limit": 20,
  "data": [
    {
      "id": "550e8400-...",
      "video_key": "cooking_pasta",
      "user_id": "alice",
      "status": "COMPLETED",
      "duration_sec": 32.5,
      "resolution_width": 1920,
      "resolution_height": 1080,
      "fps": 30.0,
      "codec": "h264",
      "recorded_at": "2026-03-14T09:30:22Z",
      "thumbnail_url": "/files/alice/thumbnails/cooking_pasta_a1b2c3d4.jpg",
      "dashboard_video_url": "/files/alice/dashboard/cooking_pasta_a1b2c3d4.mp4",
      "vlm_video_path": "/data/datasets/alice/vlm/cooking_pasta_a1b2c3d4.mp4",
      "scene_summary": null,
      "clip_segments": null,
      "created_at": "2026-03-14T09:35:00Z"
    }
  ]
}
```

**권한:**
- 일반 User: `user_id` 필터가 자동으로 본인 ID로 고정됨. `user_id` 파라미터 무시
- Admin: `user_id` 파라미터로 특정 사용자 필터 가능. 생략 시 전체

**엣지 케이스:**
- 결과 없음 → `{ "total": 0, "page": 1, "data": [] }`
- page가 범위를 초과 → 빈 data 반환 (에러 아님)
- 일반 User가 `user_id` 파라미터에 타인 ID를 넣어도 → 무시하고 본인 데이터만 반환 (403이 아닌 조용한 무시)

---

### 4.2 GET /videos/:videoId/status

특정 영상의 처리 상태를 조회한다.

**인증:** 필수

**Path Parameters:**
- `videoId`: UUID

**200 OK:**
```json
{
  "id": "550e8400-...",
  "status": "PROCESSING",
  "progress": 45,
  "error_message": null,
  "processing_started_at": "2026-03-14T09:35:10Z",
  "processing_completed_at": null
}
```

**에러:**

| HTTP | 코드 | 조건 |
|---|---|---|
| 404 | `NOT_FOUND` | videoId에 해당하는 영상 없음 |
| 403 | `FORBIDDEN` | 일반 User가 타인 영상 조회 시도 |

---

### 4.3 DELETE /videos/:videoId

영상을 삭제한다. DB 레코드와 모든 관련 파일(vlm, dashboard, thumbnail)을 함께 삭제한다.

**인증:** 필수

**Path Parameters:**
- `videoId`: UUID

**200 OK:**
```json
{
  "id": "550e8400-...",
  "deleted": true
}
```

**Backend 내부 동작:**
1. DB에서 Video 조회 + 권한 확인
2. 파일 시스템에서 vlm, dashboard, thumbnails 파일 삭제
3. DB 레코드 삭제

**에러:**

| HTTP | 코드 | 조건 |
|---|---|---|
| 404 | `NOT_FOUND` | videoId 없음 |
| 403 | `FORBIDDEN` | 일반 User가 타인 영상 삭제 시도 |

**엣지 케이스:**
- status가 `PROCESSING` 중인 영상 삭제 시도 → 삭제 허용하되, 진행 중인 Worker Job은 파일을 찾지 못해 FAILED로 전환됨
- 파일이 이미 물리적으로 없는 경우(수동 삭제 등) → 파일 삭제는 무시하고 DB 레코드만 삭제 (에러 미발생)

---

## 5. Admin

### 5.1 POST /admin/users

새 사용자 계정을 생성한다.

**인증:** 필수 (Admin only)

**Request Body:**
```json
{
  "id": "string (1~64자, [a-z0-9_] 허용, 필수)",
  "password": "string (8~255자, 필수)",
  "displayName": "string (최대 255자, 선택)"
}
```

**Zod 스키마:**
```typescript
z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  password: z.string().min(8).max(255),
  displayName: z.string().max(255).optional(),
})
```

**201 Created:**
```json
{
  "user": {
    "id": "bob",
    "role": "user",
    "displayName": "Bob Lee",
    "createdAt": "2026-03-14T10:00:00Z"
  }
}
```

**에러:**

| HTTP | 코드 | 조건 |
|---|---|---|
| 409 | `CONFLICT` | 해당 id가 이미 존재 |
| 403 | `FORBIDDEN` | Admin이 아닌 사용자 호출 |

---

### 5.2 GET /admin/users

사용자 목록을 조회한다.

**인증:** 필수 (Admin only)

**200 OK:**
```json
{
  "users": [
    {
      "id": "admin",
      "role": "admin",
      "displayName": "Administrator",
      "createdAt": "2026-03-01T00:00:00Z"
    },
    {
      "id": "alice",
      "role": "user",
      "displayName": "Alice Kim",
      "createdAt": "2026-03-10T09:00:00Z"
    }
  ]
}
```

---

### 5.3 DELETE /admin/users/:userId

사용자를 삭제한다.

**인증:** 필수 (Admin only)

**Path Parameters:**
- `userId`: 삭제할 사용자 ID

**200 OK:**
```json
{
  "id": "bob",
  "deleted": true
}
```

**에러:**

| HTTP | 코드 | 조건 |
|---|---|---|
| 404 | `NOT_FOUND` | userId 없음 |
| 400 | `VALIDATION_ERROR` | admin 계정 삭제 시도 → `"Admin 계정은 삭제할 수 없습니다"` |

**엣지 케이스:**
- 해당 사용자의 영상 데이터가 남아있는 경우 → 사용자는 삭제하되, 영상 데이터(DB + 파일)는 유지. 고아 데이터는 Admin이 별도로 관리
- 삭제된 사용자의 활성 스트림 세션이 Redis에 남아있을 수 있음 → 자연 TTL 만료로 정리

---

### 5.4 PUT /admin/users/:userId/reset-password

사용자 비밀번호를 초기화한다.

**인증:** 필수 (Admin only)

**Request Body:**
```json
{
  "newPassword": "string (8~255자, 필수)"
}
```

**200 OK:**
```json
{
  "id": "alice",
  "passwordReset": true
}
```

---

### 5.5 GET /admin/settings

현재 서버 설정을 조회한다.

**인증:** 필수 (Admin only)

**200 OK:**
```json
{
  "settings": {
    "target_directory": "/data/datasets"
  }
}
```

---

### 5.6 PUT /admin/settings/target-directory

영상 저장 대상 디렉토리를 변경한다.

**인증:** 필수 (Admin only)

**Request Body:**
```json
{
  "target_directory": "string (절대 경로, 필수)"
}
```

**Zod 스키마:**
```typescript
z.object({
  target_directory: z.string().min(1).startsWith('/'),
})
```

**200 OK:**
```json
{
  "target_directory": "/data/datasets"
}
```

**Backend 내부 동작:**
- 경로 존재 여부 확인 (없으면 생성 시도)
- DB settings 테이블 업데이트
- 이미 저장된 영상의 경로는 변경되지 않음. 이후 새 영상부터 적용

**엣지 케이스:**
- 존재하지 않는 경로 → 디렉토리 자동 생성 (mkdir -p). 생성 실패 시 400 에러
- 이전 target_directory의 데이터는 이동되지 않음 → Admin에게 안내 메시지 반환

---

## 6. 사용자 본인 (User Self)

### 6.1 PUT /users/me/password

본인의 비밀번호를 변경한다.

**인증:** 필수

**Request Body:**
```json
{
  "currentPassword": "string (필수)",
  "newPassword": "string (8~255자, 필수)"
}
```

**Zod 스키마:**
```typescript
z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(255),
})
```

**200 OK:**
```json
{
  "message": "Password changed successfully"
}
```

**에러:**

| HTTP | 코드 | 조건 |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | currentPassword가 기존 비밀번호와 불일치 |
| 400 | `VALIDATION_ERROR` | newPassword 형식 불충족 (8자 미만 등) |

---

## 7. 헬스체크

### 7.1 GET /health

서버 상태를 확인한다.

**인증:** 불필요

**200 OK:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-14T09:30:00Z",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

**503 Service Unavailable:**
```json
{
  "status": "degraded",
  "timestamp": "2026-03-14T09:30:00Z",
  "services": {
    "database": "disconnected",
    "redis": "connected"
  }
}
```

---

## 정적 파일 서빙

Dashboard 영상 재생과 썸네일 로딩을 위해 Final Storage의 파일을 HTTP로 서빙한다.

**경로 패턴:** `/files/{user_id}/{subdir}/{filename}`

**인증:** 필수 (JWT 쿼리 파라미터 또는 Bearer 헤더)

**권한:**
- 일반 User: 본인 `user_id` 경로만 접근 가능
- Admin: 모든 `user_id` 경로 접근 가능

**구현:** Express `express.static` + 인증 미들웨어로 경로 내 `user_id`를 JWT의 userId와 비교

**엣지 케이스:**
- 파일이 존재하지 않음 → 404
- user_id 경로 조작 시도 (`../` 등) → 400 또는 403
- PROCESSING 상태인 영상의 파일 요청 → 파일이 아직 없으므로 404

---

*이 문서는 EgoFlow API의 상세 명세이며, 구현 시 `EgoFlow_IMPLEMENTATION_GUIDE.md`와 함께 참조한다.*
