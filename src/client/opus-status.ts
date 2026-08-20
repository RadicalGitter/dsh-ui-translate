export type OpusModelPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface OpusModelSnapshot {
  phase: OpusModelPhase
  progress?: number
  detail?: string
}

type Listener = () => void

class OpusModelStatusStore {
  private snapshot: OpusModelSnapshot = Object.freeze({ phase: 'idle' })
  private readonly listeners = new Set<Listener>()

  readonly getSnapshot = (): OpusModelSnapshot => this.snapshot

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(snapshot: OpusModelSnapshot): void {
    const next = Object.freeze({ ...snapshot })
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

export const opusModelStatus = new OpusModelStatusStore()
