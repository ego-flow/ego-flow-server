import { describe, expect, it, vi } from 'vitest'

import { triggerLoginOnPasswordEnter } from '#/routes/login'

describe('LoginPage password enter behavior', () => {
  it('triggers login submit when Enter is pressed in password field', () => {
    const preventDefault = vi.fn()
    const submitLogin = vi.fn()

    triggerLoginOnPasswordEnter(
      {
        key: 'Enter',
        preventDefault,
      },
      submitLogin,
    )

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(submitLogin).toHaveBeenCalledTimes(1)
  })

  it('does not trigger login submit for non-Enter keys', () => {
    const preventDefault = vi.fn()
    const submitLogin = vi.fn()

    triggerLoginOnPasswordEnter(
      {
        key: 'Tab',
        preventDefault,
      },
      submitLogin,
    )

    expect(preventDefault).not.toHaveBeenCalled()
    expect(submitLogin).not.toHaveBeenCalled()
  })
})
