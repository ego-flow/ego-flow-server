import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'

import { getApiErrorMessage } from '#/api/client'
import {
  requestAddRepositoryMember,
  requestDeleteRepository,
  requestDeleteRepositoryMember,
  requestRepositoryDetail,
  requestRepositoryMembers,
  requestUpdateRepository,
  requestUpdateRepositoryMember,
  type RepositoryRole,
  type RepositoryVisibility,
} from '#/api/repositories'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { formatDateTime } from '#/lib/format'
import { defaultRepositoriesSearch } from '#/lib/route-search'

export const Route = createFileRoute('/repositories/$repoId/settings')({
  component: RepositorySettingsPage,
})

function RepositorySettingsPage() {
  const { repoId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const repositorySearch = useSearch({ from: '/repositories/$repoId' })
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<RepositoryVisibility>('private')
  const [description, setDescription] = useState('')
  const [memberUserId, setMemberUserId] = useState('')
  const [memberRole, setMemberRole] = useState<RepositoryRole>('read')

  const repositoryQuery = useQuery({
    queryKey: ['repository', repoId],
    queryFn: () => requestRepositoryDetail(repoId),
  })

  const membersQuery = useQuery({
    queryKey: ['repository-members', repoId],
    queryFn: () => requestRepositoryMembers(repoId),
    enabled: repositoryQuery.data?.myRole === 'admin',
  })

  useEffect(() => {
    if (!repositoryQuery.data) {
      return
    }

    setName(repositoryQuery.data.name)
    setVisibility(repositoryQuery.data.visibility)
    setDescription(repositoryQuery.data.description ?? '')
  }, [repositoryQuery.data])

  const updateMutation = useMutation({
    mutationFn: () =>
      requestUpdateRepository(repoId, {
        name,
        visibility,
        description,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['repositories'] })
      await queryClient.invalidateQueries({ queryKey: ['repository', repoId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => requestDeleteRepository(repoId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['repositories'] })
      await navigate({ to: '/repositories', search: defaultRepositoriesSearch })
    },
  })

  const addMemberMutation = useMutation({
    mutationFn: () =>
      requestAddRepositoryMember(repoId, {
        userId: memberUserId,
        role: memberRole,
      }),
    onSuccess: async () => {
      setMemberUserId('')
      setMemberRole('read')
      await queryClient.invalidateQueries({ queryKey: ['repository-members', repoId] })
    },
  })

  const repository = repositoryQuery.data

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <div className="mb-5">
        <Link
          to="/repositories/$repoId"
          params={{ repoId }}
          search={repositorySearch}
          className="text-sm font-semibold text-[var(--lagoon-deep)] no-underline hover:underline"
        >
          Back to repository
        </Link>
      </div>

      {repositoryQuery.isError ? (
        <section className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
          {getApiErrorMessage(repositoryQuery.error, 'Failed to load repository settings.')}
        </section>
      ) : null}

      {repository ? (
        <>
          <section className="island-shell rounded-2xl p-6 shadow-sm">
            <p className="island-kicker mb-2">Repository</p>
            <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
              Settings
            </h1>
            <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
              Manage repository metadata, visibility, and access control.
            </p>

            {repository.myRole !== 'admin' ? (
              <div className="mt-6 rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center text-[var(--sea-ink-soft)]">
                You need repository admin permission to update these settings.
              </div>
            ) : (
              <form
                className="mt-6 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  updateMutation.mutate()
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="repo-name">Repository name</Label>
                  <Input id="repo-name" value={name} onChange={(event) => setName(event.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="repo-visibility">Visibility</Label>
                  <select
                    id="repo-visibility"
                    value={visibility}
                    onChange={(event) => setVisibility(event.target.value as RepositoryVisibility)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="private">private</option>
                    <option value="public">public</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="repo-description">Description</Label>
                  <textarea
                    id="repo-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>

                {updateMutation.isError ? (
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {getApiErrorMessage(updateMutation.error, 'Failed to update repository.')}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={updateMutation.isPending || !name.trim()}>
                    Save changes
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (!window.confirm('Delete this repository and all associated files?')) {
                        return
                      }

                      deleteMutation.mutate()
                    }}
                  >
                    Delete repository
                  </Button>
                </div>
              </form>
            )}
          </section>

          {repository.myRole === 'admin' ? (
            <section className="island-shell mt-6 rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-[var(--sea-ink)]">Members</h2>
              <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
                Repository access is controlled per member.
              </p>

              <form
                className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
                onSubmit={(event) => {
                  event.preventDefault()
                  addMemberMutation.mutate()
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="member-user-id">User ID</Label>
                  <Input
                    id="member-user-id"
                    value={memberUserId}
                    onChange={(event) => setMemberUserId(event.target.value)}
                    placeholder="alice"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-role">Role</Label>
                  <select
                    id="member-role"
                    value={memberRole}
                    onChange={(event) => setMemberRole(event.target.value as RepositoryRole)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="read">read</option>
                    <option value="maintain">maintain</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={addMemberMutation.isPending || !memberUserId.trim()}>
                    Add member
                  </Button>
                </div>
              </form>

              {addMemberMutation.isError ? (
                <p className="mt-4 text-sm text-red-700 dark:text-red-300">
                  {getApiErrorMessage(addMemberMutation.error, 'Failed to add repository member.')}
                </p>
              ) : null}

              <div className="mt-6 space-y-4">
                {membersQuery.isPending ? (
                  <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center text-[var(--sea-ink-soft)]">
                    Loading members...
                  </div>
                ) : membersQuery.isError ? (
                  <div className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
                    {getApiErrorMessage(membersQuery.error, 'Failed to load repository members.')}
                  </div>
                ) : (
                  (membersQuery.data ?? []).map((member) => (
                    <article
                      key={member.userId}
                      className="rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] p-4"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-[var(--sea-ink)]">
                              {member.displayName || member.userId}
                            </h3>
                            <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-xs text-[var(--sea-ink-soft)]">
                              {member.role}
                            </span>
                            {member.isOwner ? (
                              <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-xs text-[var(--sea-ink-soft)]">
                                owner
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">{member.userId}</p>
                          <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
                            Added {formatDateTime(member.createdAt)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {!member.isOwner ? (
                            <>
                              <select
                                value={member.role}
                                onChange={(event) => {
                                  void requestUpdateRepositoryMember(
                                    repoId,
                                    member.userId,
                                    event.target.value as RepositoryRole,
                                  ).then(async () => {
                                    await queryClient.invalidateQueries({
                                      queryKey: ['repository-members', repoId],
                                    })
                                  })
                                }}
                                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              >
                                <option value="read">read</option>
                                <option value="maintain">maintain</option>
                                <option value="admin">admin</option>
                              </select>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  if (!window.confirm(`Remove ${member.userId} from this repository?`)) {
                                    return
                                  }

                                  void requestDeleteRepositoryMember(repoId, member.userId).then(async () => {
                                    await queryClient.invalidateQueries({
                                      queryKey: ['repository-members', repoId],
                                    })
                                  })
                                }}
                              >
                                Remove
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  )
}
