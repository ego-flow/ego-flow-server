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
        bearerFormat: "JWT",
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
      HealthResponse: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", example: "ok" },
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
        required: ["repository_id", "repository_name", "rtmp_url", "status"],
        properties: {
          repository_id: { type: "string", format: "uuid" },
          repository_name: { type: "string", example: "daily_kitchen" },
          rtmp_url: { type: "string", example: "rtmp://127.0.0.1:1935/live/daily_kitchen?user=alice&pass=<jwt>" },
          status: { type: "string", enum: ["ready"] },
        },
      },
      ActiveStream: {
        type: "object",
        required: ["repository_id", "repository_name", "owner_id", "user_id", "device_type", "hls_url", "registered_at"],
        properties: {
          repository_id: { type: "string", format: "uuid" },
          repository_name: { type: "string" },
          owner_id: { type: "string" },
          user_id: { type: "string" },
          device_type: { type: ["string", "null"] },
          hls_url: { type: "string", example: "http://127.0.0.1:8888/live/daily_kitchen/index.m3u8" },
          registered_at: { type: "string", format: "date-time" },
        },
      },
      ActiveStreamsResponse: {
        type: "object",
        required: ["streams"],
        properties: {
          streams: {
            type: "array",
            items: { $ref: "#/components/schemas/ActiveStream" },
          },
        },
      },
      StopStreamResponse: {
        type: "object",
        required: ["repository_id", "status"],
        properties: {
          repository_id: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["stopping"] },
        },
      },
      RecordingCompleteResponse: {
        type: "object",
        required: ["video_id", "status"],
        properties: {
          video_id: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] },
        },
      },
      Video: {
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
          "dashboard_video_url",
          "vlm_video_path",
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
          vlm_video_path: { type: ["string", "null"] },
          scene_summary: { type: ["string", "null"] },
          clip_segments: {},
          created_at: { type: "string", format: "date-time" },
        },
      },
      VideoListResponse: {
        type: "object",
        required: ["total", "page", "limit", "data"],
        properties: {
          total: { type: "integer", minimum: 0 },
          page: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1 },
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/Video" },
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
              target_directory: { type: "string", example: "/data/datasets" },
            },
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
        summary: "Login and receive an access token",
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
        summary: "Register a stream session before RTMP publish",
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
    "/streams/active": {
      get: {
        tags: ["Streams"],
        summary: "List active streams visible to the current user",
        responses: {
          "200": {
            description: "Active stream list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ActiveStreamsResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/streams/{repositoryId}": {
      delete: {
        tags: ["Streams"],
        summary: "Request stream stop for a repository",
        parameters: [{ $ref: "#/components/parameters/RepositoryId" }],
        responses: {
          "200": {
            description: "Stop requested",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/StopStreamResponse" },
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
    "/hooks/recording-complete": {
      get: {
        tags: ["Hooks"],
        summary: "Handle MediaMTX recording complete webhook",
        security: [],
        parameters: [
          {
            name: "path",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "recording_path",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Video row created or reused",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RecordingCompleteResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      post: {
        tags: ["Hooks"],
        summary: "Handle MediaMTX recording complete webhook",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["path", "recording_path"],
                properties: {
                  path: { type: "string" },
                  recording_path: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Video row created or reused",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RecordingCompleteResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/videos": {
      get: {
        tags: ["Videos"],
        summary: "List videos",
        parameters: [
          {
            name: "repository_id",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
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
            description: "Video list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VideoListResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/videos/{videoId}": {
      get: {
        tags: ["Videos"],
        summary: "Get video detail",
        parameters: [{ $ref: "#/components/parameters/VideoId" }],
        responses: {
          "200": {
            description: "Video detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Video" },
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
        summary: "Delete a video",
        parameters: [{ $ref: "#/components/parameters/VideoId" }],
        responses: {
          "200": {
            description: "Video deleted",
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
    "/videos/{videoId}/status": {
      get: {
        tags: ["Videos"],
        summary: "Get video processing status",
        parameters: [{ $ref: "#/components/parameters/VideoId" }],
        responses: {
          "200": {
            description: "Video status",
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
