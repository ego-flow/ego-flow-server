import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { useAuth } from '#/hooks/useAuth'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useAppForm } from '#/hooks/demo.form'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

const loginSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  password: z.string().trim().min(1, 'Password is required'),
  rememberMe: z.boolean(),
})

type LoginFormValues = z.infer<typeof loginSchema>

function LoginPage() {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { isReady, isAuthenticated, login } = useAuth()
  const navigate = useNavigate()

  const form = useAppForm({
    defaultValues: {
      id: '',
      password: '',
      rememberMe: false,
    },
    validators: {
      onChange: loginSchema,
      onBlur: loginSchema,
      onSubmit: loginSchema,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null)

      try {
        await login(value)
        await navigate({ to: '/repositories' })
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : 'Unable to process login right now.',
        )
      }
    },
  })

  if (!isReady) {
    return null
  }

  if (isAuthenticated) {
    return <Navigate to="/repositories" />
  }

  return (
    <main className="page-wrap grid min-h-[calc(100dvh-5rem)] place-items-center px-4 py-12 sm:py-16">
      <section className="island-shell w-full max-w-md rounded-2xl p-6 shadow-xl sm:p-8">
        <h1 className="display-title text-balance text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          Log in
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--sea-ink-soft)]">
          Welcome to EgoFlow.
          <br />
          Sign in to continue to your repositories.
        </p>

        <form
          className="mt-7 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void form.handleSubmit()
          }}
        >
          <form.Field name="id">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="login-id">ID</Label>
                <Input
                  id="login-id"
                  type="text"
                  autoComplete="username"
                  placeholder="Enter your ID"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.isTouched &&
                  field.state.meta.errors.length > 0 && (
                    <p className="text-sm font-medium text-red-600">
                      {typeof field.state.meta.errors[0] === 'string'
                        ? field.state.meta.errors[0]
                        : field.state.meta.errors[0]?.message}
                    </p>
                  )}
              </div>
            )}
          </form.Field>

          <form.Field name="password">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your Password"
                  minLength={1}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.isTouched &&
                  field.state.value.trim().length === 0 &&
                  field.state.meta.errors.length > 0 && (
                    <p className="text-sm font-medium text-red-600">
                      {typeof field.state.meta.errors[0] === 'string'
                        ? field.state.meta.errors[0]
                        : field.state.meta.errors[0]?.message}
                    </p>
                  )}
              </div>
            )}
          </form.Field>

          <form.Field name="rememberMe">
            {(field) => (
              <label
                htmlFor="login-remember"
                className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-[var(--sea-ink-soft)]"
              >
                <input
                  id="login-remember"
                  type="checkbox"
                  className="h-4 w-4 rounded border-[var(--line)] accent-[var(--lagoon-deep)]"
                  checked={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.checked)}
                />
                Remember me
              </label>
            )}
          </form.Field>

          {submitError && <p className="text-sm font-medium text-red-600">{submitError}</p>}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Preparing request...' : 'Log in'}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </section>
    </main>
  )
}
