import { apiClient } from '#/api/client'

export type RepositoryVisibility = 'public' | 'private'
export type RepositoryRole = 'read' | 'maintain' | 'admin'

export interface RepositoryRecord {
  id: string
  name: string
  ownerId: string
  visibility: RepositoryVisibility
  description: string | null
  myRole: RepositoryRole
  createdAt: string
  updatedAt: string
}

export interface RepositoryMember {
  userId: string
  displayName: string | null
  isActive: boolean
  role: RepositoryRole
  isOwner: boolean
  createdAt: string
}

interface RepositoryApiRecord {
  id: string
  name: string
  owner_id: string
  visibility: RepositoryVisibility
  description: string | null
  my_role: RepositoryRole
  created_at: string
  updated_at: string
}

function normalizeRepository(repository: RepositoryApiRecord): RepositoryRecord {
  return {
    id: repository.id,
    name: repository.name,
    ownerId: repository.owner_id,
    visibility: repository.visibility,
    description: repository.description,
    myRole: repository.my_role,
    createdAt: repository.created_at,
    updatedAt: repository.updated_at,
  }
}

export async function requestRepositories() {
  const response = await apiClient.get<{
    repositories: RepositoryApiRecord[]
  }>('/repositories')

  return response.data.repositories.map(normalizeRepository) satisfies RepositoryRecord[]
}

export async function requestMyRepositories() {
  const response = await apiClient.get<{
    repositories: RepositoryApiRecord[]
  }>('/repositories/mine')

  return response.data.repositories.map(normalizeRepository) satisfies RepositoryRecord[]
}

export async function requestRepositoryDetail(repoId: string) {
  const response = await apiClient.get<{
    repository: RepositoryApiRecord
  }>(`/repositories/${repoId}`)

  return normalizeRepository(response.data.repository)
}

export async function requestCreateRepository(input: {
  name: string
  visibility: RepositoryVisibility
  description: string
}) {
  const response = await apiClient.post<{
    repository: RepositoryApiRecord
  }>('/repositories', {
    name: input.name.trim(),
    visibility: input.visibility,
    description: input.description.trim() || undefined,
  })

  return normalizeRepository(response.data.repository)
}

export async function requestUpdateRepository(
  repoId: string,
  input: {
    name: string
    visibility: RepositoryVisibility
    description: string
  },
) {
  const response = await apiClient.patch<{
    repository: RepositoryApiRecord
  }>(`/repositories/${repoId}`, {
    name: input.name.trim(),
    visibility: input.visibility,
    description: input.description.trim() || null,
  })

  return normalizeRepository(response.data.repository)
}

export async function requestDeleteRepository(repoId: string) {
  const response = await apiClient.delete<{
    id: string
    deleted: boolean
  }>(`/repositories/${repoId}`)

  return response.data
}

export async function requestRepositoryMembers(repoId: string) {
  const response = await apiClient.get<{
    members: Array<{
      user_id: string
      display_name: string | null
      is_active: boolean
      role: RepositoryRole
      is_owner: boolean
      created_at: string
    }>
  }>(`/repositories/${repoId}/members`)

  return response.data.members.map((member) => ({
    userId: member.user_id,
    displayName: member.display_name,
    isActive: member.is_active,
    role: member.role,
    isOwner: member.is_owner,
    createdAt: member.created_at,
  })) satisfies RepositoryMember[]
}

export async function requestAddRepositoryMember(
  repoId: string,
  input: { userId: string; role: RepositoryRole },
) {
  await apiClient.post(`/repositories/${repoId}/members`, {
    user_id: input.userId.trim(),
    role: input.role,
  })
}

export async function requestUpdateRepositoryMember(
  repoId: string,
  userId: string,
  role: RepositoryRole,
) {
  await apiClient.patch(`/repositories/${repoId}/members/${encodeURIComponent(userId)}`, {
    role,
  })
}

export async function requestDeleteRepositoryMember(repoId: string, userId: string) {
  await apiClient.delete(`/repositories/${repoId}/members/${encodeURIComponent(userId)}`)
}
