# ego-flow-py Renewal Notes

이 문서는 `~/ego-flow/ego-flow-py`를 최신 EgoFlow 서버 구조에 맞추면서 반영한 내용과, 아직 후속 작업으로 남겨둔 내용을 정리한다. Python package의 목적은 VLM 연구 환경에서 `pip install ego-flow` 후 서버에 저장된 repository dataset과 live playback을 Python interface로 쉽게 사용하는 것이다.

## 반영된 내용

1. package 설치 이름은 `ego-flow`로 유지한다.
   - `pyproject.toml`의 distribution name은 `ego-flow`이다.
   - import package는 `ego_flow`이다.

2. 별도 port 설정을 제거했다.
   - 환경 변수, 함수 인자, config field에서 별도 port 설정을 제거했다.
   - `EF_SERVER_ENDPOINT`만으로 `{endpoint}/api/v1`을 만든다.
   - 서버 public HTTP port는 80 고정 정책을 따른다.

3. repository resolve response의 tags를 파싱한다.
   - `RepositoryInfo.tags: list[str]`를 추가했다.
   - `GET /api/v1/repositories/resolve` 응답에 포함된 `tags`를 Python model에 보존한다.

4. manifest repository metadata는 현재 서버 구조를 유지한다.
   - manifest의 repository object는 `id`, `name`, `owner_id`, `visibility`, `my_role`만 사용한다.
   - dataset row에 repository tags를 추가하려면 server manifest response 확장이 먼저 필요하지만, 지금은 하지 않는다.

5. live stream id는 `recording_session_id`로 통일했다.
   - 이전 live stream id 별칭을 제거했다.
   - `LiveStream` metadata와 `source_id`도 `recording_session_id`를 사용한다.

6. `stream_path` fallback을 제거했다.
   - 최신 서버 stream path는 `live/{repositoryName}/{recordingSessionId}`이다.
   - 서버 response에 `stream_path`가 없으면 Python package는 임의 path를 만들지 않는다.
   - playback open 단계에서 `stream_path` 누락 오류를 명확히 발생시킨다.

7. live API response 구조를 최신 서버 기준으로 맞췄다.
   - `GET /api/v1/live-streams` 목록 응답은 progress fields를 기대하지 않는다.
   - `GET /api/v1/live-streams/{recordingSessionId}` 상세 응답에서만 `bytes_received`, `last_sequence`, `last_chunk_at`을 nullable field로 받는다.
   - `POST /api/v1/live-streams/{recordingSessionId}/playback-ticket` 응답은 `{ playback_ticket }`만 기대한다.

8. client-side live stream filter helper를 추가했다.
   - `filter_live_streams()`를 public API로 export했다.
   - `list_live_streams()`도 `ingest_type`, `playback_available`, `repository_id`, `repository_name` 기준 filter 인자를 받는다.
   - HTTP ingest stream은 목록/상세 조회 대상이지만 HLS playback 대상은 아니다.

9. HLS direct playback은 fixed `8888` 정책을 유지한다.
   - Python package는 `http://{host}:8888/{stream_path}/index.m3u8?ticket=...&user_id=...`를 구성한다.
   - Authorization header는 HLS playlist/segment request에 붙이지 않는다.

10. semantic metadata는 pass-through 확장 지점만 둔다.
    - semantic metadata 추출은 server 역할이다.
    - Python package는 서버가 `semantic_metadata` object를 내려주면 dataset row에 그대로 담을 수 있게 했다.
    - 기존 flat `scene_summary`, `clip_segments` field는 유지한다.

11. tests와 README를 최신 구조로 갱신했다.
    - port 없는 endpoint 구성.
    - repository tags parsing.
    - `recording_session_id` only live model.
    - live list/detail response 차이.
    - playback ticket response shape.

## 후속 작업

1. 서버 error envelope가 확정되면 Python error parser를 맞춘다.
   - 현재 Python client는 top-level `message`, `error`, `details`를 읽는다.
   - 서버 error response가 `{ error: { code, message, details } }` 형태로 고정되면 `_raise_for_http_error()`를 갱신한다.

2. semantic metadata server response가 구체화되면 Python model을 확장한다.
   - 현재는 `semantic_metadata: dict` pass-through만 둔다.
   - 서버가 action labels, embeddings, VLM summary 등을 안정적으로 제공하면 typed helper 또는 row schema를 추가한다.

3. `download_mode="reuse_dataset_if_exists"` semantics는 현재 구조로 유지한다.
   - 지금은 `force_redownload`가 아닌 경우 file cache hit를 재사용한다.
   - Hugging Face Datasets 수준의 dataset snapshot 재사용 정책은 별도 요구가 있을 때 다룬다.
