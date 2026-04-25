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
    { name: "Users" },
    { name: "Admin" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "App JWT or Python token",
      },
      dashboardCookie: {
        type: "apiKey",
        in: "cookie",
        name: "egoflow_session",
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
          password: { type: "string", maxLength: 255, example: "changeme123" },
        },
      },
      AuthUser: {
        type: "object",
        required: ["id", "role", "displayName"],
        properties: {
          id: { type: "string", example: "admin" },
          role: { type: "string", enum: ["admin", "user"] },
          displayName: { type: ["string", "null"], example: "Administrator" },
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
          password: { type: "string", maxLength: 255, example: "changeme123" },
          remember_me: { type: "boolean", default: false },
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
      ValidateAuthResponse: {
        type: "object",
        required: ["user"],
        properties: {
          user: {
            type: "object",
            required: ["id", "role", "display_name"],
            properties: {
              id: { type: "string", example: "alice" },
              role: { type: "string", enum: ["admin", "user"] },
              display_name: { type: ["string", "null"], example: "Alice Kim" },
            },
          },
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
            required: ["api_base", "hls_base"],
            properties: {
              api_base: { type: "string", example: "/api/v1" },
              hls_base: { type: "string", example: "/hls" },
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
      RepositoryListResponse: {
        type: "object",
        required: ["repositories"],
        properties: {
          repositories: {
            type: "array",
            items: { $ref: "#/components/schemas/Repository" },
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
      RepositoryMember: {
        type: "object",
        required: ["user_id", "display_name", "is_active", "role", "is_owner", "created_at"],
        properties: {
          user_id: { type: "string", example: "bob" },
          display_name: { type: ["string", "null"], example: "Bob" },
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
        required: ["repository_id"],
        properties: {
          repository_id: { type: "string", format: "uuid" },
          device_type: { type: "string", maxLength: 100, example: "meta-rayban" },
        },
      },
      StreamRegisterResponse: {
        type: "object",
        required: ["recording_session_id", "repository_id", "repository_name", "stream_path", "status"],
        properties: {
          recording_session_id: { type: "string", format: "uuid" },
          repository_id: { type: "string", format: "uuid" },
          repository_name: { type: "string", example: "daily_kitchen" },
          stream_path: { type: "string", example: "live/daily_kitchen" },
          status: { type: "string", enum: ["pending"], description: "Temporary reservation created; publish-ticket must be issued before RTMP publish." },
        },
      },
      PublishTicketResponse: {
        type: "object",
        required: [
          "recording_session_id",
          "repository_id",
          "repository_name",
          "stream_path",
          "connection_id",
          "generation",
          "publish_ticket",
          "publish_ticket_expires_at",
          "rtmp_publish_base_url",
        ],
        properties: {
          recording_session_id: { type: "string", format: "uuid" },
          repository_id: { type: "string", format: "uuid" },
          repository_name: { type: "string", example: "daily_kitchen" },
          stream_path: { type: "string", example: "live/daily_kitchen" },
          connection_id: { type: "string", example: "conn_3f8f9ec5-7cbc-4a0d-9d30-e25b085b1a47" },
          generation: { type: "integer", example: 1 },
          publish_ticket: { type: "string", example: "t_0d87967b-903e-4f69-af58-24fdd6dd2a82" },
          publish_ticket_expires_at: { type: "string", format: "date-time" },
          rtmp_publish_base_url: { type: "string", example: "rtmp://127.0.0.1:1935/live" },
        },
      },
      StreamConnectionHeartbeatRequest: {
        type: "object",
        required: ["generation"],
        properties: {
          generation: { type: "integer", example: 1 },
        },
      },
      StreamConnectionHeartbeatResponse: {
        type: "object",
        required: [
          "ok",
          "recording_session_id",
          "connection_id",
          "generation",
          "lease_expires_at",
          "owner_status",
        ],
        properties: {
          ok: { type: "boolean", example: true },
          recording_session_id: { type: "string", format: "uuid" },
          connection_id: { type: "string", example: "conn_3f8f9ec5-7cbc-4a0d-9d30-e25b085b1a47" },
          generation: { type: "integer", example: 1 },
          lease_expires_at: { type: "string", format: "date-time" },
          owner_status: { type: "string", enum: ["claimed", "publishing"], example: "publishing" },
        },
      },
      LiveStreamSummary: {
        type: "object",
        required: [
          "stream_id",
          "repository_id",
          "repository_name",
          "owner_id",
          "user_id",
          "device_type",
          "registered_at",
          "status",
          "hls_path",
        ],
        properties: {
          stream_id: { type: "string", format: "uuid" },
          repository_id: { type: "string", format: "uuid" },
          repository_name: { type: "string" },
          owner_id: { type: "string" },
          user_id: { type: "string" },
          device_type: { type: ["string", "null"] },
          registered_at: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["live"] },
          hls_path: { type: "string", example: "/hls/live/daily_kitchen/index.m3u8" },
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
          "stream_id",
          "repository_id",
          "repository_name",
          "owner_id",
          "user_id",
          "device_type",
          "stream_path",
          "source_type",
          "source_id",
          "registered_at",
          "status",
          "playback_ready",
        ],
        properties: {
          stream_id: { type: "string", format: "uuid" },
          repository_id: { type: "string", format: "uuid" },
          repository_name: { type: "string" },
          owner_id: { type: "string" },
          user_id: { type: "string" },
          device_type: { type: ["string", "null"] },
          stream_path: { type: "string", example: "live/daily_kitchen" },
          source_type: { type: ["string", "null"], example: "rtmpConn" },
          source_id: { type: ["string", "null"] },
          registered_at: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["live"] },
          playback_ready: { type: "boolean" },
        },
      },
      LiveStreamPlayback: {
        type: "object",
        required: ["stream_id", "repository_id", "repository_name", "protocol", "hls_path", "auth"],
        properties: {
          stream_id: { type: "string", format: "uuid" },
          repository_id: { type: "string", format: "uuid" },
          repository_name: { type: "string" },
          protocol: { type: "string", enum: ["hls"] },
          hls_path: { type: "string", example: "/hls/live/daily_kitchen/index.m3u8" },
          auth: {
            type: "object",
            required: ["type", "header_name", "scheme", "token", "expires_in_seconds"],
            properties: {
              type: { type: "string", enum: ["bearer"] },
              header_name: { type: "string", example: "Authorization" },
              scheme: { type: "string", example: "Bearer" },
              token: { type: "string", example: "efp_0123456789abcdef" },
              expires_in_seconds: { type: "integer", example: 300 },
            },
          },
        },
      },
      RecordingStopRequest: {
        type: "object",
        properties: {
          reason: { type: "string", enum: ["USER_STOP", "GLASSES_STOP"], default: "USER_STOP" },
        },
      },
      RecordingStopResponse: {
        type: "object",
        required: ["recording_session_id", "status"],
        properties: {
          recording_session_id: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["stop_requested"] },
        },
      },
      RecordingStatusResponse: {
        type: "object",
        required: ["id", "status", "end_reason", "segment_count", "video_id", "created_at", "ready_at", "not_ready_at", "finalized_at"],
        properties: {
          id: { type: "string", format: "uuid" },
          status: {
            type: "string",
            enum: ["PENDING", "STREAMING", "STOP_REQUESTED", "FINALIZING", "COMPLETED", "FAILED", "ABORTED"],
          },
          end_reason: {
            oneOf: [
              { type: "string", enum: ["USER_STOP", "GLASSES_STOP", "UNEXPECTED_DISCONNECT", "REGISTRATION_TIMEOUT", "INTERNAL_ERROR"] },
              { type: "null" },
            ],
          },
          segment_count: { type: "integer", minimum: 0 },
          video_id: { type: ["string", "null"], format: "uuid" },
          created_at: { type: "string", format: "date-time" },
          ready_at: { type: ["string", "null"], format: "date-time" },
          not_ready_at: { type: ["string", "null"], format: "date-time" },
          finalized_at: { type: ["string", "null"], format: "date-time" },
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
        required: ["path", "source_id", "source_type"],
          properties: {
            path: { type: "string", example: "live/daily_kitchen" },
            query: { type: "string", example: "ticket=t_opaque" },
            source_id: { type: "string", example: "publisher-123" },
            source_type: { type: "string", example: "rtmpConn" },
          },
      },
      StreamNotReadyHookRequest: {
        type: "object",
        required: ["path", "source_id", "source_type"],
        properties: {
          path: { type: "string", example: "live/daily_kitchen" },
          source_id: { type: "string", example: "publisher-123" },
          source_type: { type: "string", example: "rtmpConn" },
        },
      },
      RecordingSegmentCreateHookRequest: {
        type: "object",
        required: ["path", "source_id", "segment_path"],
        properties: {
          path: { type: "string", example: "live/daily_kitchen" },
          source_id: { type: "string", example: "publisher-123" },
          segment_path: { type: "string", example: "/data/raw/live/daily_kitchen/2026-03-30_10-20-30-000000" },
        },
      },
      RecordingSegmentCompleteHookRequest: {
        type: "object",
        required: ["path", "source_id", "segment_path"],
        properties: {
          path: { type: "string", example: "live/daily_kitchen" },
          source_id: { type: "string", example: "publisher-123" },
          segment_path: { type: "string", example: "/data/raw/live/daily_kitchen/2026-03-30_10-20-30-000000" },
          segment_duration: { type: "number", example: 15.2 },
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
          status: { type: "string", enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] },
          duration_sec: { type: ["number", "null"] },
          resolution_width: { type: ["integer", "null"] },
          resolution_height: { type: ["integer", "null"] },
          fps: { type: ["number", "null"] },
          codec: { type: ["string", "null"] },
          recorded_at: { type: ["string", "null"], format: "date-time" },
          thumbnail_url: { type: ["string", "null"] },
          dashboard_video_url: { type: ["string", "null"] },
          scene_summary: { type: ["string", "null"] },
          clip_segments: {},
          created_at: { type: "string", format: "date-time" },
        },
      },
      RepositoryVideoListResponse: {
        type: "object",
        required: ["total", "page", "limit", "data"],
        properties: {
          total: { type: "integer", minimum: 0 },
          page: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1 },
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
          status: { type: "string", enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] },
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
          newPassword: { type: "string", minLength: 8, maxLength: 255 },
        },
      },
      CreateApiTokenRequest: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100, example: "python-package" },
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
        required: ["id", "role", "displayName", "createdAt", "is_active"],
        properties: {
          id: { type: "string" },
          role: { type: "string", enum: ["admin", "user"] },
          displayName: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          is_active: { type: "boolean" },
        },
      },
      CreateAdminUserRequest: {
        type: "object",
        required: ["id", "password"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9_]+$", maxLength: 64 },
          password: { type: "string", minLength: 8, maxLength: 255 },
          displayName: { type: "string", minLength: 1, maxLength: 255 },
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
      ResetPasswordRequest: {
        type: "object",
        required: ["newPassword"],
        properties: {
          newPassword: { type: "string", minLength: 8, maxLength: 255 },
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
            required: ["target_directory"],
            properties: {
              target_directory: { type: "string", example: "/home/egoflow/ego-flow-data/datasets" },
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
          display_name: { type: ["string", "null"] },
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
          download_url: { type: "string", example: "/api/v1/repositories/{repoId}/videos/{videoId}/thumbnail" },
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
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Legacy app login and receive an app access token",
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
                description: "HttpOnly egoflow_session cookie.",
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
    "/auth/tokens": {
      get: {
        tags: ["Auth"],
        summary: "Get the current user's active Python token metadata",
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
      post: {
        tags: ["Auth"],
        summary: "Issue or rotate the current user's Python token",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateApiTokenRequest" },
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
    },
    "/auth/validate": {
      get: {
        tags: ["Auth"],
        summary: "Validate the current bearer token",
        responses: {
          "200": {
            description: "Authenticated user",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ValidateAuthResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/auth/tokens/{tokenId}": {
      delete: {
        tags: ["Auth"],
        summary: "Revoke a Python token",
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
    "/auth/rtmp": {
      post: {
        tags: ["Auth"],
        summary: "MediaMTX RTMP/HLS authorization hook",
        description: "Internal endpoint used by MediaMTX for publish/read/playback authorization.",
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
    "/repositories/mine": {
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
        summary: "Delete a repository",
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        responses: {
          "200": {
            description: "Repository deleted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DeleteResult" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
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
        },
      },
    },
    "/streams/{recordingSessionId}/connections/{connectionId}/heartbeat": {
      post: {
        tags: ["Streams"],
        summary: "Refresh the owner lease for the active publish connection",
        parameters: [
          {
            name: "recordingSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "connectionId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StreamConnectionHeartbeatRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Owner lease refreshed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/StreamConnectionHeartbeatResponse" },
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
    "/live-streams/{streamId}": {
      get: {
        tags: ["Live Streams"],
        summary: "Get live stream detail",
        parameters: [
          {
            name: "streamId",
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
    "/live-streams/{streamId}/playback": {
      get: {
        tags: ["Live Streams"],
        summary: "Get HLS playback path and ephemeral bearer token",
        parameters: [
          {
            name: "streamId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Playback info with ephemeral bearer token",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LiveStreamPlayback" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/recordings/{recordingSessionId}/stop": {
      post: {
        tags: ["Recordings"],
        summary: "Request stop for a recording session",
        parameters: [
          {
            name: "recordingSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RecordingStopRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Stop requested",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RecordingStopResponse" },
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
    "/recordings/{recordingSessionId}": {
      get: {
        tags: ["Recordings"],
        summary: "Get recording session status",
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
            description: "Recording session status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RecordingStatusResponse" },
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
        summary: "Handle MediaMTX recording-segment-create hook with authoritative source mapping",
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
        summary: "Handle MediaMTX recording-segment-complete hook with authoritative segment mapping",
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
            schema: { type: "string", enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] },
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
            schema: { type: "string", enum: ["created_at", "recorded_at", "duration_sec"], default: "created_at" },
          },
          {
            name: "sort_order",
            in: "query",
            schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
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
      head: {
        tags: ["Videos"],
        summary: "Resolve repository video download redirect metadata",
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
    "/repositories/{repoId}/videos/{videoId}/thumbnail": {
      get: {
        tags: ["Videos"],
        summary: "Download a repository video thumbnail",
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { $ref: "#/components/parameters/VideoId" },
        ],
        responses: {
          "200": {
            description: "Thumbnail image stream",
            headers: {
              "Cache-Control": { schema: { type: "string", example: "public, max-age=86400" } },
            },
            content: {
              "image/jpeg": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/users/me/password": {
      put: {
        tags: ["Users"],
        summary: "Change the current user's password",
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
    "/admin/api-tokens": {
      get: {
        tags: ["Admin"],
        summary: "List active Python tokens for all users",
        parameters: [
          {
            name: "user_id",
            in: "query",
            required: false,
            schema: { type: "string", pattern: "^[a-z0-9_]+$", maxLength: 64 },
          },
        ],
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
        summary: "Deactivate a user",
        parameters: [{ $ref: "#/components/parameters/UserId" }],
        responses: {
          "200": {
            description: "User deactivated",
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
        },
      },
    },
    "/admin/users/{userId}/reset-password": {
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
