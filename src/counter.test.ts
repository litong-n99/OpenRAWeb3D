import { describe, it, expect } from 'vitest'
import { setupCounter } from './counter'

describe('setupCounter', () => {
  it('initializes counter to 0', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    setupCounter(button)
    expect(button.innerHTML).toBe('Count is 0')
    document.body.removeChild(button)
  })

  it('increments counter on click', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    setupCounter(button)
    button.click()
    expect(button.innerHTML).toBe('Count is 1')
    button.click()
    expect(button.innerHTML).toBe('Count is 2')
    document.body.removeChild(button)
  })
})
