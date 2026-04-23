class ResizeObserverMock {
  constructor(private callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: {
            width: 960,
            height: 540,
            top: 0,
            left: 0,
            bottom: 540,
            right: 960,
            x: 0,
            y: 0,
            toJSON: () => null,
          },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver
    )
  }

  unobserve() {}

  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  writable: true,
  value: () => ({
    width: 960,
    height: 540,
    top: 0,
    left: 0,
    right: 960,
    bottom: 540,
    x: 0,
    y: 0,
    toJSON: () => null,
  }),
})

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return 960
  },
})

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return 540
  },
})

Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get() {
    return 960
  },
})

Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get() {
    return 540
  },
})

// Stub react-joyride in the jsdom environment — the real library depends on
// browser APIs that aren't fully available in tests and inflates render
// output for integration suites. OnboardingRuntime lazily imports this, so
// tests just need a default export that renders nothing.
import { vi } from 'vitest'
vi.mock('react-joyride', () => ({
  __esModule: true,
  default: () => null,
  STATUS: { FINISHED: 'finished', SKIPPED: 'skipped' },
  EVENTS: { STEP_AFTER: 'step:after' },
}))