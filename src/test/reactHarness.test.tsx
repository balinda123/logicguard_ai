import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

it('renders React TSX with Testing Library matchers', () => {
  render(<button type="button">Run design</button>)

  expect(screen.getByRole('button', { name: 'Run design' })).toBeInTheDocument()
})
