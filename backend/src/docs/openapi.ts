import { DASHBOARD_SESSION_COOKIE_NAME, HttpAuthScheme } from "../constants/auth/auth-constants";

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "EgoFlow Server API",
    version: "1.0.0",
    description:
      "OpenAPI document for the current EgoFlow backend implementation. The API is repository-centric for access control, streaming, storage, and video retrieval.",
  },
  servers: [
    {
      url: "/api/v1",
      description: "Current backend API base path",
    },
  ],
  tags: [
    { name: "System" },
    { name: "Auth" },
    { name: "Repositories" },
    { name: "Repository Members" },
    { name: "Streams" },
    { name: "Recordings" },
    { name: "Hooks" },
    { name: "Videos" },
    { name: "Admin" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: HttpAuthScheme.Bearer.toLowerCase(),
        bearerFormat: "App JWT or Python token",
      },
      dashboardCookie: {
        type: "apiKey",
        in: "cookie",
        name: DASHBOARD_SESSION_COOKIE_NAME,
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["error", "message"],
        properties: {
          error: { type: "string", example: "VALIDATION_ERROR" },
          message: { type: "string", example: "Invalid request payload." },
          details: {
            oneOf: [{ type: "array", items: { type: "object" } }, { type: "null" }],
          },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["id", "password"],
        properties: {
          id: { type: "string", maxLength: 64, example: "admin" },
          password: { type: "string", example: "changeme123" },
        },
      },
      AuthUser: {
        type: "object",
        required: ["id", "role", "displayName"],
        properties: {
          id: { type: "string", example: "admin" },
          role: { type: "string", enum: ["admin", "user"] },
          displayName: { type: "string", example: "Administrator" },
        },
      },
      LoginResponse: {
        type: "object",
        required: ["token", "user"],
        properties: {
          token: { type: "string", example: "<jwt>" },
          user: { $ref: "#/components/schemas/AuthUser" },
        },
      },
      DashboardLoginRequest: {
        type: "object",
        required: ["id", "password"],
        properties: {
          id: { type: "string", maxLength: 64, example: "admin" },
          password: { type: "string", example: "changeme123" },
          remember_me: { type: "boolean", default: false },
        },
      },
      IssuePythonTokenRequest: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100, example: "python-package" },
        },
      },
      PythonTokenValidateResponse: {
        type: "object",
        required: ["valid", "user"],
        properties: {
          valid: { type: "boolean", example: true },
          user: {
            type: "object",
            required: ["id", "role", "display_name"],
            properties: {
              id: { type: "string", example: "alice" },
              role: { type: "string", enum: ["admin", "user"] },
              display_name: { type: "string", example: "Alice Kim" },
            },
          },
        },
      },
      DashboardSessionResponse: {
        type: "object",
        required: ["user"],
        properties: {
          user: { $ref: "#/components/schemas/AuthUser" },
        },
      },
      DashboardLogoutResponse: {
        type: "object",
        required: ["logged_out"],
        properties: {
          logged_out: { type: "boolean", example: true },
        },
      },
      HealthResponse: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", example: "ok" },
        },
      },
      InfoResponse: {
        type: "object",
        required: ["api_version", "server_version", "capabilities", "urls"],
        properties: {
          api_version: { type: "string", example: "v1" },
          server_version: { type: "string", example: "0.1.0" },
          capabilities: {
            type: "object",
            required: ["dataset_manifest", "video_download", "thumbnail_download", "live_streams", "python_tokens"],
            properties: {
              dataset_manifest: { type: "boolean" },
              video_download: { type: "boolean" },
              thumbnail_download: { type: "boolean" },
              live_streams: { type: "boolean" },
              python_tokens: { type: "boolean" },
            },
          },
          urls: {
            type: "object",
            required: ["api_base", "hls_port"],
            properties: {
              api_base: { type: "string", example: "/api/v1" },
              hls_port: { type: "integer", example: 8888 },
            },
          },
        },
      },
      Repository: {
        type: "object",
        required: ["id", "name", "owner_id", "visibility", "description", "my_role", "created_at", "updated_at"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", pattern: "^[a-z0-9_-]+$", maxLength: 64 },
          owner_id: { type: "string", example: "alice" },
          visibility: { type: "string", enum: ["public", "private"] },
          description: { type: ["string", "null"] },
          my_role: { type: "string", enum: ["read", "maintain", "admin"] },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      RepositorySummary: {
        allOf: [
          { $ref: "#/components/schemas/Repository" },
          {
            type: "object",
            required: ["video_count"],
            properties: {
              video_count: { type: "integer", minimum: 0, example: 12 },
            },
          },
        ],
      },
      RepositoryListResponse: {
        type: "object",
        required: ["repositories"],
        properties: {
          repositories: {
            type: "array",
            items: { $ref: "#/components/schemas/RepositorySummary" },
          },
        },
      },
      CreateRepositoryRequest: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", pattern: "^[a-z0-9_-]+$", maxLength: 64, example: "daily_kitchen" },
          visibility: { type: "string", enum: ["public", "private"], default: "private" },
          description: { type: "string", maxLength: 500, example: "Dataset for kitchen tasks." },
        },
      },
      UpdateRepositoryRequest: {
        type: "object",
        properties: {
          name: { type: "string", pattern: "^[a-z0-9_-]+$", maxLength: 64 },
          visibility: { type: "string", enum: ["public", "private"] },
          description: {
            oneOf: [{ type: "string", maxLength: 500 }, { type: "null" }],
          },
        },
        additionalProperties: false,
      },
      RepositoryDetailResponse: {
        type: "object",
        required: ["repository"],
        properties: {
          repository: { $ref: "#/components/schemas/Repository" },
        },
      },
      DeleteResult: {
        type: "object",
        required: ["id", "deleted"],
        properties: {
          id: { type: "string" },
          deleted: { type: "boolean", example: true },
        },
      },
      DeactivateResult: {
        type: "object",
        required: ["id", "deactivated"],
        properties: {
          id: { type: "string" },
          deactivated: { type: "boolean", example: true },
        },
      },
      RepositoryDeleteReadiness: {
        type: "object",
        required: ["repository_id", "can_delete", "checks"],
        properties: {
          repository_id: { type: "string", format: "uuid" },
          can_delete: { type: "boolean" },
          checks: {
            type: "object",
            required: [
              "is_deactivated",
              "active_streaming_session_count",
              "finalizing_segment_count",
            ],
            properties: {
              is_deactivated: { type: "boolean" },
              active_streaming_session_count: { type: "integer", minimum: 0 },
              finalizing_segment_count: { type: "integer", minimum: 0 },
            },
          },
        },
      },
      RepositoryMember: {
        type: "object",
        required: ["user_id", "display_name", "is_active", "role", "is_owner", "created_at"],
        properties: {
          user_id: { type: "string", example: "bob" },
          display_name: { type: "string", example: "Bob" },
          is_active: { type: "boolean" },
          role: { type: "string", enum: ["read", "maintain", "admin"] },
          is_owner: { type: "boolean" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      RepositoryMembersResponse: {
        type: "object",
        required: ["repository", "members"],
        properties: {
          repository: { $ref: "#/components/schemas/Repository" },
          members: {
            type: "array",
            items: { $ref: "#/components/schemas/RepositoryMember" },
          },
        },
      },
      CreateRepositoryMemberRequest: {
        type: "object",
        required: ["user_id", "role"],
        properties: {
          user_id: { type: "string", pattern: "^[a-z0-9_]+$", maxLength: 64, example: "bob" },
          role: { type: "string", enum: ["read", "maintain", "admin"] },
        },
      },
      UpdateRepositoryMemberRequest: {
        type: "object",
        required: ["role"],
        properties: {
          role: { type: "string", enum: ["read", "maintain", "admin"] },
        },
      },
      StreamRegisterRequest: {
        type: "object",
        required: ["repositoryId", "ingestType"],
        properties: {
          repositoryId: { type: "string", format: "uuid" },
          deviceType: { type: "string", maxLength: 100, example: "meta-rayban" },
          ingestType: { type: "string", enum: ["MEDIAMTX", "HTTP"], example: "MEDIAMTX" },
        },
      },
      StreamRegisterResponse: {
        type: "object",
        required: ["recordingSessionId"],
        properties: {
          recordingSessionId: { type: "string", format: "uuid" },
        },
      },
      PublishTicketResponse: {
        type: "object",
        required: [
          "stream_path",
          "publish_ticket",
        ],
        properties: {
          stream_path: { type: "string", example: "live/daily_kitchen/2b42c60f-8e94-4c85-933f-182c6496e620" },
          publish_ticket: { type: "string", example: "t_0d87967b-903e-4f69-af58-24fdd6dd2a82" },
        },
      },
      HttpStreamStartRequest: {
        type: "object",
        required: ["publish_ticket"],
        properties: {
          publish_ticket: { type: "string", example: "t_0d87967b-903e-4f69-af58-24fdd6dd2a82" },
        },
      },
      HttpStreamStartResponse: {
        type: "object",
        required: ["recording_session_id", "status", "bytes_received", "last_sequence"],
        properties: {
          recording_session_id: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["STREAMING"] },
          bytes_received: { type: "integer", minimum: 0 },
          last_sequence: { type: ["integer", "null"], minimum: 0 },
        },
      },
      HttpStreamChunkResponse: {
        type: "object",
        required: ["recording_session_id", "bytes_received", "last_sequence"],
        properties: {
          recording_session_id: { type: "string", format: "uuid" },
          bytes_received: { type: "integer", minimum: 0 },
          last_sequence: { type: "integer", minimum: 0 },
        },
      },
      HttpStreamFinishRequest: {
        type: "object",
        required: ["total_bytes"],
        properties: {
          total_bytes: { type: "integer", minimum: 0 },
        },
      },
      HttpStreamFinishResponse: {
        type: "object",
        required: ["recording_session_id", "status", "segment_status", "bytes_received"],
        properties: {
          recording_session_id: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["CLOSED"] },
          segment_status: { type: "string", enum: ["WRITE_DONE"] },
          bytes_received: { type: "integer", minimum: 0 },
        },
      },
      RecordingCloseIntentRequest: {
        type: "object",
        required: ["reason"],
        properties: {
          reason: { type: "string", enum: ["NORMAL_DISCONNECT"] },
        },
      },
      RecordingCloseIntentResponse: {
        type: "object",
        required: ["ok"],
        properties: {
          ok: { type: "boolean", example: true },
        },
      },
      LiveStreamSummary: {
        type: "object",
        required: [
          "recording_session_id",
          "repository_id",
          "repository_name",
          "user_id",
          "device_type",
          "ingest_type",
          "stream_path",
          "status",
          "playback_available",
          "bytes_received",
          "last_sequence",
          "last_chunk_at",
        ],
        properties: {
          recording_session_id: { type: "string", format: "uuid" },
          repository_id: { type: "string", format: "uuid" },
          repository_name: { type: "string" },
          user_id: { type: "string" },
          device_type: { type: ["string", "null"] },
          ingest_type: { type: "string", enum: ["MEDIAMTX", "HTTP"] },
          stream_path: { type: "string", example: "live/daily_kitchen/2b42c60f-8e94-4c85-933f-182c6496e620" },
          status: { type: "string", enum: ["live"] },
          playback_available: { type: "boolean" },
          bytes_received: { type: ["integer", "null"], minimum: 0 },
          last_sequence: { type: ["integer", "null"], minimum: 0 },
          last_chunk_at: { type: ["string", "null"], format: "date-time" },
        },
      },
      LiveStreamListResponse: {
        type: "object",
        required: ["streams"],
        properties: {
          streams: {
            type: "array",
            items: { $ref: "#/components/schemas/LiveStreamSummary" },
          },
        },
      },
      LiveStreamDetail: {
        type: "object",
        required: [
          "recording_session_id",
          "repository_id",
          "repository_name",
          "owner_id",
          "user_id",
          "device_type",
          "ingest_type",
          "stream_path",
          "registered_at",
          "status",
          "playback_available",
          "playback_ready",
        ],
        properties: {
          recording_session_id: { type: "string", format: "uuid" },
          repository_id: { type: "string", format: "uuid" },
          repository_name: { type: "string" },
          owner_id: { type: "string" },
          user_id: { type: "string" },
          device_type: { type: ["string", "null"] },
          ingest_type: { type: "string", enum: ["MEDIAMTX", "HTTP"] },
          stream_path: { type: "string", example: "live/daily_kitchen/2b42c60f-8e94-4c85-933f-182c6496e620" },
          registered_at: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["live"] },
          playback_available: { type: "boolean" },
          playback_ready: { type: "boolean" },
        },
      },
      HlsPlaybackTicketResponse: {
        type: "object",
        required: ["playback_ticket"],
        properties: {
          playback_ticket: { type: "string", example: "pt_opaque" },
        },
      },
      HookOkResponse: {
        type: "object",
        required: ["ok"],
        properties: {
          ok: { type: "boolean", example: true },
        },
      },
      StreamReadyHookRequest: {
        type: "object",
        required: ["path", "ticket"],
        properties: {
          path: { type: "string", example: "live/daily_kitchen/2b42c60f-8e94-4c85-933f-182c6496e620" },
          ticket: { type: "string", example: "t_opaque" },
        },
      },
      StreamNotReadyHookRequest: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", example: "live/daily_kitchen/2b42c60f-8e94-4c85-933f-182c6496e620" },
        },
      },
      RecordingSegmentCreateHookRequest: {
        type: "object",
        required: ["path", "segment_path"],
        properties: {
          path: { type: "string", example: "live/daily_kitchen/2b42c60f-8e94-4c85-933f-182c6496e620" },
          segment_path: { type: "string", example: "/data/raw/live/daily_kitchen/2026-03-30_10-20-30-000000" },
        },
      },
      RecordingSegmentCompleteHookRequest: {
        type: "object",
        required: ["path", "segment_path"],
        properties: {
          path: { type: "string", example: "live/daily_kitchen/2b42c60f-8e94-4c85-933f-182c6496e620" },
          segment_path: { type: "string", example: "/data/raw/live/daily_kitchen/2026-03-30_10-20-30-000000" },
        },
      },
      RepositoryVideo: {
        type: "object",
        required: [
          "id",
          "repository_id",
          "repository_name",
          "owner_id",
          "status",
          "duration_sec",
          "resolution_width",
          "resolution_height",
          "fps",
          "codec",
          "recorded_at",
          "size_bytes",
          "contributor_user_id",
          "contributor_display_name",
          "thumbnail_url",
          "scene_summary",
          "clip_segments",
          "created_at",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          repository_id: { type: "string", format: "uuid" },
          repository_name: { type: "string" },
          owner_id: { type: "string" },
          status: { type: "string", enum: ["COMPLETED", "FAILED"] },
          duration_sec: { type: ["number", "null"] },
          resolution_width: { type: ["integer", "null"] },
          resolution_height: { type: ["integer", "null"] },
          fps: { type: ["number", "null"] },
          codec: { type: ["string", "null"] },
          recorded_at: { type: ["string", "null"], format: "date-time" },
          size_bytes: { type: ["integer", "null"], example: 104857600 },
          contributor_user_id: { type: ["string", "null"], example: "alice" },
          contributor_display_name: { type: ["string", "null"], example: "Alice Kim" },
          thumbnail_url: { type: ["string", "null"] },
          dashboard_video_url: { type: ["string", "null"] },
          scene_summary: { type: ["string", "null"] },
          clip_segments: {},
          created_at: { type: "string", format: "date-time" },
        },
      },
      RepositoryVideoListResponse: {
        type: "object",
        required: ["total", "page", "limit", "contributors", "data"],
        properties: {
          total: { type: "integer", minimum: 0 },
          page: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1 },
          contributors: {
            type: "array",
            items: {
              type: "object",
              required: ["user_id", "display_name", "video_count", "latest_recorded_at"],
              properties: {
                user_id: { type: "string", example: "alice" },
                display_name: { type: "string", example: "Alice Kim" },
                video_count: { type: "integer", minimum: 0 },
                latest_recorded_at: { type: ["string", "null"], format: "date-time" },
              },
            },
          },
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/RepositoryVideo" },
          },
        },
      },
      VideoStatusResponse: {
        type: "object",
        required: ["id", "repository_id", "status", "progress", "error_message", "processing_started_at", "processing_completed_at"],
        properties: {
          id: { type: "string", format: "uuid" },
          repository_id: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["COMPLETED", "FAILED"] },
          progress: { type: "integer", minimum: 0, maximum: 100 },
          error_message: { type: ["string", "null"] },
          processing_started_at: { type: ["string", "null"], format: "date-time" },
          processing_completed_at: { type: ["string", "null"], format: "date-time" },
        },
      },
      ChangePasswordRequest: {
        type: "object",
        required: ["currentPassword", "newPassword"],
        properties: {
          currentPassword: { type: "string" },
          newPassword: { type: "string" },
        },
      },
      ApiTokenMetadata: {
        type: "object",
        required: ["id", "name", "last_used_at", "created_at"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          last_used_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      CreateApiTokenResponse: {
        type: "object",
        required: ["id", "name", "token", "created_at", "rotated_previous"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          token: { type: "string", example: "ef_0123456789abcdef0123456789abcdef01234567" },
          created_at: { type: "string", format: "date-time" },
          rotated_previous: { type: "boolean" },
        },
      },
      CurrentApiTokenResponse: {
        type: "object",
        required: ["token"],
        properties: {
          token: {
            oneOf: [
              { $ref: "#/components/schemas/ApiTokenMetadata" },
              { type: "null" },
            ],
          },
        },
      },
      RevokeApiTokenResponse: {
        type: "object",
        required: ["id", "revoked"],
        properties: {
          id: { type: "string", format: "uuid" },
          revoked: { type: "boolean", example: true },
        },
      },
      MessageResponse: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string" },
        },
      },
      AdminUser: {
        type: "object",
        required: ["id", "role", "displayName", "createdAt", "deactivated"],
        properties: {
          id: { type: "string" },
          role: { type: "string", enum: ["admin", "user"] },
          displayName: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          deactivated: { type: "boolean" },
        },
      },
      CreateAdminUserRequest: {
        type: "object",
        required: ["id", "password"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9_]+$", maxLength: 64 },
          password: { type: "string" },
          displayName: { type: "string", maxLength: 255 },
        },
      },
      UsersResponse: {
        type: "object",
        required: ["users"],
        properties: {
          users: {
            type: "array",
            items: { $ref: "#/components/schemas/AdminUser" },
          },
        },
      },
      AdminUserDeleteReadiness: {
        type: "object",
        required: ["user_id", "can_delete", "checks"],
        properties: {
          user_id: { type: "string" },
          can_delete: { type: "boolean" },
          checks: {
            type: "object",
            required: [
              "is_deactivated",
              "owned_repository_count",
              "repository_membership_count",
              "recording_session_count",
            ],
            properties: {
              is_deactivated: { type: "boolean" },
              owned_repository_count: { type: "integer", minimum: 0 },
              repository_membership_count: { type: "integer", minimum: 0 },
              recording_session_count: { type: "integer", minimum: 0 },
            },
          },
        },
      },
      ResetPasswordRequest: {
        type: "object",
        required: ["newPassword"],
        properties: {
          newPassword: { type: "string" },
        },
      },
      PasswordResetResponse: {
        type: "object",
        required: ["id", "passwordReset"],
        properties: {
          id: { type: "string" },
          passwordReset: { type: "boolean", example: true },
        },
      },
      SettingsResponse: {
        type: "object",
        required: ["settings"],
        properties: {
          settings: {
            type: "object",
            required: ["target_directory", "config_path", "dotenv_path", "sections"],
            properties: {
              target_directory: { type: "string", example: "/home/egoflow/ego-flow-data/datasets" },
              config_path: { type: "string", example: "/home/egoflow/ego-flow-server/config.json" },
              dotenv_path: { type: "string", example: "/home/egoflow/ego-flow-server/.env" },
              sections: {
                type: "array",
                items: {
                  type: "object",
                  required: ["title", "description", "entries"],
                  properties: {
                    title: { type: "string", example: "config.json" },
                    description: { type: ["string", "null"], example: "Values loaded from config.json." },
                    entries: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["key", "value", "sensitive", "source_path", "children"],
                        properties: {
                          key: { type: "string", example: "JWT_SECRET" },
                          value: {
                            oneOf: [
                              { type: "string" },
                              { type: "number" },
                              { type: "boolean" },
                              { type: "null" },
                            ],
                          },
                          sensitive: { type: "boolean", example: true },
                          source_path: { type: ["string", "null"], example: "/home/egoflow/ego-flow-server/.env" },
                          children: {
                            type: "array",
                            items: {
                              type: "object",
                              required: ["key", "value", "sensitive", "source_path", "children"],
                              properties: {
                                key: { type: "string", example: "backend:3000/tcp" },
                                value: { type: ["string", "number", "boolean", "null"] },
                                sensitive: { type: "boolean", example: false },
                                source_path: { type: ["string", "null"], example: null },
                                children: { type: "array", items: {} },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      AdminApiToken: {
        type: "object",
        required: ["id", "user_id", "user_role", "display_name", "name", "last_used_at", "created_at"],
        properties: {
          id: { type: "string", format: "uuid" },
          user_id: { type: "string", example: "alice" },
          user_role: { type: "string", enum: ["admin", "user"] },
          display_name: { type: "string" },
          name: { type: "string" },
          last_used_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      AdminApiTokensResponse: {
        type: "object",
        required: ["tokens"],
        properties: {
          tokens: {
            type: "array",
            items: { $ref: "#/components/schemas/AdminApiToken" },
          },
        },
      },
      ManifestArtifact: {
        type: "object",
        required: ["download_url", "size_bytes", "sha256", "content_type"],
        properties: {
          download_url: { type: "string", example: "/api/v1/repositories/{repoId}/videos/{videoId}/download" },
          size_bytes: { type: "integer", example: 104857600 },
          sha256: { type: "string", example: "e3b0c44298fc1c149afbf4c8996fb924..." },
          content_type: { type: "string", example: "video/mp4" },
        },
      },
      ManifestThumbnailArtifact: {
        type: "object",
        required: ["download_url", "content_type"],
        properties: {
          download_url: { type: "string", example: "/files/owner/repository/.thumbnails/video.jpg?signature=..." },
          content_type: { type: "string", example: "image/jpeg" },
        },
      },
      ManifestVideo: {
        type: "object",
        required: [
          "video_id",
          "recorded_at",
          "duration_sec",
          "resolution_width",
          "resolution_height",
          "fps",
          "codec",
          "scene_summary",
          "clip_segments",
          "artifacts",
        ],
        properties: {
          video_id: { type: "string", format: "uuid" },
          recorded_at: { type: ["string", "null"], format: "date-time" },
          duration_sec: { type: ["number", "null"] },
          resolution_width: { type: ["integer", "null"] },
          resolution_height: { type: ["integer", "null"] },
          fps: { type: ["number", "null"] },
          codec: { type: ["string", "null"] },
          scene_summary: { type: ["string", "null"] },
          clip_segments: {},
          artifacts: {
            type: "object",
            required: ["vlm_video", "thumbnail"],
            properties: {
              vlm_video: { $ref: "#/components/schemas/ManifestArtifact" },
              thumbnail: {
                oneOf: [
                  { $ref: "#/components/schemas/ManifestThumbnailArtifact" },
                  { type: "null" },
                ],
              },
            },
          },
        },
      },
      ManifestResponse: {
        type: "object",
        required: ["manifest_version", "repository", "default_artifact", "pagination", "videos"],
        properties: {
          manifest_version: { type: "string", example: "1" },
          repository: {
            type: "object",
            required: ["id", "owner_id", "name", "visibility", "my_role"],
            properties: {
              id: { type: "string", format: "uuid" },
              owner_id: { type: "string", example: "alice" },
              name: { type: "string", example: "daily_kitchen" },
              visibility: { type: "string", enum: ["public", "private"] },
              my_role: { type: "string", enum: ["read", "maintain", "admin"] },
            },
          },
          default_artifact: { type: "string", example: "vlm_video" },
          pagination: {
            type: "object",
            required: ["total", "page", "limit", "has_next"],
            properties: {
              total: { type: "integer", minimum: 0 },
              page: { type: "integer", minimum: 1 },
              limit: { type: "integer", minimum: 1 },
              has_next: { type: "boolean" },
            },
          },
          videos: {
            type: "array",
            items: { $ref: "#/components/schemas/ManifestVideo" },
          },
        },
      },
    },
    parameters: {
      RepoId: {
        name: "repoId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      RepositoryId: {
        name: "repositoryId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      VideoId: {
        name: "videoId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      UserId: {
        name: "userId",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[a-z0-9_]+$", maxLength: 64 },
      },
      TokenId: {
        name: "tokenId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    },
    responses: {
      BadRequest: {
        description: "Bad request",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      Unauthorized: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      Forbidden: {
        description: "Forbidden",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      NotFound: {
        description: "Not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      Conflict: {
        description: "Conflict",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      PreconditionFailed: {
        description: "Precondition failed",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Health check",
        security: [],
        responses: {
          "200": {
            description: "Backend is healthy",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
    "/info": {
      get: {
        tags: ["System"],
        summary: "Server capability metadata",
        security: [],
        responses: {
          "200": {
            description: "Server capability metadata",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InfoResponse" },
              },
            },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        tags: ["System"],
        summary: "OpenAPI document",
        security: [],
        responses: {
          "200": {
            description: "OpenAPI document",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    },
    "/auth/app/login": {
      post: {
        tags: ["Auth"],
        summary: "App login and receive an app access token",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Login succeeded",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/auth/dashboard/login": {
      post: {
        tags: ["Auth"],
        summary: "Dashboard login and set the HttpOnly session cookie",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DashboardLoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Dashboard session created",
            headers: {
              "Set-Cookie": {
                schema: { type: "string" },
                description: `HttpOnly ${DASHBOARD_SESSION_COOKIE_NAME} cookie.`,
              },
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DashboardSessionResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/auth/dashboard/session": {
      get: {
        tags: ["Auth"],
        summary: "Return the current dashboard session user",
        security: [{ dashboardCookie: [] }],
        responses: {
          "200": {
            description: "Dashboard session user",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DashboardSessionResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/auth/dashboard/logout": {
      post: {
        tags: ["Auth"],
        summary: "Revoke the current dashboard session and clear the cookie",
        security: [{ dashboardCookie: [] }],
        responses: {
          "200": {
            description: "Dashboard session revoked",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DashboardLogoutResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/auth/dashboard/me/password": {
      put: {
        tags: ["Auth"],
        summary: "Change the current dashboard user's password",
        security: [{ dashboardCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChangePasswordRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Password changed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MessageResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/auth/python/tokens": {
      post: {
        tags: ["Auth"],
        summary: "Issue or rotate the current dashboard user's Python static token",
        security: [{ dashboardCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/IssuePythonTokenRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Python token issued",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateApiTokenResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      get: {
        tags: ["Auth"],
        summary: "Get the current dashboard user's active Python token metadata",
        security: [{ dashboardCookie: [] }],
        responses: {
          "200": {
            description: "Current Python token status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CurrentApiTokenResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/auth/python/tokens/validate": {
      get: {
        tags: ["Auth"],
        summary: "Validate the current Python static token",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Python token is valid",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PythonTokenValidateResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/auth/python/tokens/{tokenId}": {
      delete: {
        tags: ["Auth"],
        summary: "Revoke a Python token",
        security: [{ dashboardCookie: [] }],
        parameters: [{ $ref: "#/components/parameters/TokenId" }],
        responses: {
          "200": {
            description: "Python token revoked",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RevokeApiTokenResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/auth/mediamtx": {
      post: {
        tags: ["Auth"],
        summary: "MediaMTX authorization hook",
        description: "Internal endpoint used by MediaMTX for publish and HLS read authorization.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  user: { type: "string" },
                  password: { type: "string" },
                  token: { type: "string" },
                  action: { type: "string" },
                  path: { type: "string" },
                  protocol: { type: "string" },
                  query: { type: "string" },
                  id: { type: "string" },
                  ip: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Authorized" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/repositories": {
      get: {
        tags: ["Repositories"],
        summary: "List repositories accessible to the current user",
        responses: {
          "200": {
            description: "Repository list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryListResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Repositories"],
        summary: "Create a repository",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateRepositoryRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Repository created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryDetailResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/repositories/resolve": {
      get: {
        tags: ["Repositories"],
        summary: "Resolve owner/name to an accessible repository",
        parameters: [
          {
            name: "slug",
            in: "query",
            required: false,
            schema: { type: "string", example: "alice/daily-kitchen" },
          },
          {
            name: "owner_id",
            in: "query",
            required: false,
            schema: { type: "string", pattern: "^[a-z0-9_]+$", maxLength: 64 },
          },
          {
            name: "name",
            in: "query",
            required: false,
            schema: { type: "string", pattern: "^[a-z0-9_-]+$", maxLength: 64 },
          },
        ],
        responses: {
          "200": {
            description: "Resolved repository detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryDetailResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/repositories/maintain": {
      get: {
        tags: ["Repositories"],
        summary: "List repositories where the current user has maintain or admin access",
        responses: {
          "200": {
            description: "Repository list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryListResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/repositories/{repoId}/deactivate": {
      delete: {
        tags: ["Repositories"],
        summary: "Deactivate a repository before permanent deletion",
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        responses: {
          "200": {
            description: "Repository deactivated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DeactivateResult" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/repositories/{repoId}/delete-readiness": {
      get: {
        tags: ["Repositories"],
        summary: "Check whether a repository can be permanently deleted",
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        responses: {
          "200": {
            description: "Repository permanent delete readiness",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryDeleteReadiness" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/repositories/{repoId}/manifest": {
      get: {
        tags: ["Repositories"],
        summary: "Get dataset manifest for a repository",
        description: "Returns a paginated manifest of completed videos with download artifacts. Used by the Python package for dataset synchronization.",
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          },
        ],
        responses: {
          "200": {
            description: "Repository dataset manifest",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ManifestResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/repositories/{repoId}": {
      get: {
        tags: ["Repositories"],
        summary: "Get repository detail",
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        responses: {
          "200": {
            description: "Repository detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryDetailResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Repositories"],
        summary: "Update repository metadata",
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateRepositoryRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Repository updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryDetailResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
      delete: {
        tags: ["Repositories"],
        summary: "Permanently delete a deactivated repository with no active streaming or finalization",
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        responses: {
          "200": {
            description: "Repository permanently deleted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DeleteResult" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/repositories/{repoId}/members": {
      get: {
        tags: ["Repository Members"],
        summary: "List repository members",
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        responses: {
          "200": {
            description: "Member list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryMembersResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      post: {
        tags: ["Repository Members"],
        summary: "Add or update a repository member",
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateRepositoryMemberRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated member list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryMembersResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/repositories/{repoId}/members/{userId}": {
      patch: {
        tags: ["Repository Members"],
        summary: "Update a repository member role",
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { $ref: "#/components/parameters/UserId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateRepositoryMemberRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated member list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryMembersResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Repository Members"],
        summary: "Delete a repository member",
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { $ref: "#/components/parameters/UserId" },
        ],
        responses: {
          "200": {
            description: "Member deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["repository_id", "user_id", "deleted"],
                  properties: {
                    repository_id: { type: "string", format: "uuid" },
                    user_id: { type: "string" },
                    deleted: { type: "boolean" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/streams/register": {
      post: {
        tags: ["Streams"],
        summary: "Register a recording session before publish-ticket issuance",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StreamRegisterRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Stream session registered",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/StreamRegisterResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/streams/{recordingSessionId}/publish-ticket": {
      post: {
        tags: ["Streams"],
        summary: "Issue a short-lived publish ticket for a recording session",
        parameters: [
          {
            name: "recordingSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Publish ticket issued",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PublishTicketResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "412": { $ref: "#/components/responses/PreconditionFailed" },
        },
      },
    },
    "/http-streams/{recordingSessionId}/start": {
      post: {
        tags: ["HTTP Streams"],
        summary: "Start an HTTP upload ingest session with a publish ticket",
        parameters: [
          {
            name: "recordingSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HttpStreamStartRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "HTTP stream started",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HttpStreamStartResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "412": { $ref: "#/components/responses/PreconditionFailed" },
        },
      },
    },
    "/http-streams/{recordingSessionId}/chunks": {
      post: {
        tags: ["HTTP Streams"],
        summary: "Append one binary HTTP upload chunk",
        parameters: [
          {
            name: "recordingSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "X-Chunk-Sequence",
            in: "header",
            required: true,
            schema: { type: "integer", minimum: 0 },
          },
          {
            name: "X-Chunk-Offset",
            in: "header",
            required: true,
            schema: { type: "integer", minimum: 0 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        responses: {
          "200": {
            description: "Chunk appended",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HttpStreamChunkResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "412": { $ref: "#/components/responses/PreconditionFailed" },
        },
      },
    },
    "/http-streams/{recordingSessionId}/finish": {
      post: {
        tags: ["HTTP Streams"],
        summary: "Finish an HTTP upload ingest session",
        parameters: [
          {
            name: "recordingSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HttpStreamFinishRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "HTTP stream finished",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HttpStreamFinishResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "412": { $ref: "#/components/responses/PreconditionFailed" },
        },
      },
    },
    "/live-streams": {
      get: {
        tags: ["Live Streams"],
        summary: "List active live streams visible to the current user",
        responses: {
          "200": {
            description: "Live stream list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LiveStreamListResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/live-streams/{recordingSessionId}": {
      get: {
        tags: ["Live Streams"],
        summary: "Get live stream detail",
        parameters: [
          {
            name: "recordingSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Live stream detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LiveStreamDetail" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/live-streams/{recordingSessionId}/playback-ticket": {
      post: {
        tags: ["Live Streams"],
        summary: "Issue a short-lived HLS playback ticket",
        description: "Dashboard and Python clients call this before direct MediaMTX HLS playback.",
        parameters: [
          {
            name: "recordingSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "201": {
            description: "Playback ticket issued",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HlsPlaybackTicketResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/recordings/{recordingSessionId}/close-intent": {
      post: {
        tags: ["Recordings"],
        summary: "Record normal RTMP close intent before the publisher socket closes",
        parameters: [
          {
            name: "recordingSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RecordingCloseIntentRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Close intent recorded",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RecordingCloseIntentResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/hooks/stream-ready": {
      post: {
        tags: ["Hooks"],
        summary: "Handle MediaMTX stream-ready hook",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StreamReadyHookRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Hook handled",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HookOkResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/hooks/stream-not-ready": {
      post: {
        tags: ["Hooks"],
        summary: "Handle MediaMTX stream-not-ready hook",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StreamNotReadyHookRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Hook handled",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HookOkResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/hooks/recording-segment-create": {
      post: {
        tags: ["Hooks"],
        summary: "Handle MediaMTX recording-segment-create hook",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RecordingSegmentCreateHookRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Hook handled",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HookOkResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/hooks/recording-segment-complete": {
      post: {
        tags: ["Hooks"],
        summary: "Handle MediaMTX recording-segment-complete hook",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RecordingSegmentCompleteHookRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Hook handled",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HookOkResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/repositories/{repoId}/videos": {
      get: {
        tags: ["Videos"],
        summary: "List videos in a repository",
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["COMPLETED", "FAILED"] },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: "sort_by",
            in: "query",
            schema: { type: "string", enum: ["recorded_at", "duration_sec", "size_bytes"], default: "recorded_at" },
          },
          {
            name: "sort_order",
            in: "query",
            schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
          },
          {
            name: "contributor_user_id",
            in: "query",
            schema: { type: "string", example: "alice" },
          },
        ],
        responses: {
          "200": {
            description: "Repository video list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryVideoListResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/repositories/{repoId}/videos/{videoId}": {
      get: {
        tags: ["Videos"],
        summary: "Get repository video detail",
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { $ref: "#/components/parameters/VideoId" },
        ],
        responses: {
          "200": {
            description: "Repository video detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RepositoryVideo" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Videos"],
        summary: "Delete a repository video",
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { $ref: "#/components/parameters/VideoId" },
        ],
        responses: {
          "200": {
            description: "Repository video deleted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DeleteResult" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/repositories/{repoId}/videos/{videoId}/status": {
      get: {
        tags: ["Videos"],
        summary: "Get repository video processing status",
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { $ref: "#/components/parameters/VideoId" },
        ],
        responses: {
          "200": {
            description: "Repository video status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VideoStatusResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/repositories/{repoId}/videos/{videoId}/download": {
      get: {
        tags: ["Videos"],
        summary: "Resolve a repository video download URL",
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { $ref: "#/components/parameters/VideoId" },
        ],
        responses: {
          "307": {
            description: "Temporary redirect to a signed video file URL",
            headers: {
              Location: {
                schema: { type: "string" },
                description: "Signed `/files/*` URL for the requested video.",
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/admin/users": {
      get: {
        tags: ["Admin"],
        summary: "List users",
        responses: {
          "200": {
            description: "User list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UsersResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
      post: {
        tags: ["Admin"],
        summary: "Create a user",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateAdminUserRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "User created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user"],
                  properties: {
                    user: { $ref: "#/components/schemas/AdminUser" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/admin/python/tokens": {
      get: {
        tags: ["Admin"],
        summary: "List active Python tokens for all users",
        responses: {
          "200": {
            description: "Active Python token list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AdminApiTokensResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/admin/users/{userId}": {
      delete: {
        tags: ["Admin"],
        summary: "Permanently delete a deactivated user with no remaining blockers",
        parameters: [{ $ref: "#/components/parameters/UserId" }],
        responses: {
          "200": {
            description: "User permanently deleted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DeleteResult" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/admin/users/{userId}/deactivate": {
      delete: {
        tags: ["Admin"],
        summary: "Deactivate a user",
        parameters: [{ $ref: "#/components/parameters/UserId" }],
        responses: {
          "200": {
            description: "User deactivated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DeactivateResult" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/admin/users/{userId}/delete-readiness": {
      get: {
        tags: ["Admin"],
        summary: "Check whether a user can be permanently deleted",
        parameters: [{ $ref: "#/components/parameters/UserId" }],
        responses: {
          "200": {
            description: "Permanent deletion readiness",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AdminUserDeleteReadiness" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/admin/users/{userId}/password": {
      put: {
        tags: ["Admin"],
        summary: "Reset a user's password",
        parameters: [{ $ref: "#/components/parameters/UserId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ResetPasswordRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Password reset",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PasswordResetResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/admin/settings": {
      get: {
        tags: ["Admin"],
        summary: "Get current admin settings",
        responses: {
          "200": {
            description: "Current settings",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SettingsResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
  },
} as const;
