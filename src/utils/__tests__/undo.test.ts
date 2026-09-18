import { describe, it, expect, vi } from 'vitest'
import { UitgesteldeActiePlanner } from '../undo'

// Handmatige timer zodat de test niet hoeft te wachten.
const maakTimer = () => {
  const timers = new Map<number, () => void>()
  let n = 0
  return {
    setTimer: (fn: () => void) => { const h = ++n; timers.set(h, fn); return h },
    clearTimer: (h: unknown) => { timers.delete(h as number) },
    tik: () => { for (const [h, fn] of [...timers]) { timers.delete(h); fn() } },
    open: () => timers.size,
  }
}

describe('UitgesteldeActiePlanner', () => {
  it('voert de actie pas na de vertraging uit', () => {
    const tm = maakTimer()
    const uitvoeren = vi.fn()
    const p = new UitgesteldeActiePlanner({ ...tm })
    p.plan('b1', 'Batch afgerond', uitvoeren)
    expect(uitvoeren).not.toHaveBeenCalled()
    expect(p.actie).toEqual({ id: 'b1', label: 'Batch afgerond' })
    tm.tik()
    expect(uitvoeren).toHaveBeenCalledTimes(1)
    expect(p.actie).toBeNull()
  })

  it('ongedaan maken annuleert zonder de actie ooit uit te voeren', () => {
    const tm = maakTimer()
    const uitvoeren = vi.fn()
    const p = new UitgesteldeActiePlanner({ ...tm })
    p.plan('b1', 'x', uitvoeren)
    expect(p.ongedaan()).toEqual({ id: 'b1', label: 'x' })
    tm.tik()
    expect(uitvoeren).not.toHaveBeenCalled()
    expect(tm.open()).toBe(0)
    expect(p.ongedaan()).toBeNull()
  })

  it('een tweede plan voert de eerste eerst uit', () => {
    const tm = maakTimer()
    const eerste = vi.fn(), tweede = vi.fn()
    const p = new UitgesteldeActiePlanner({ ...tm })
    p.plan('a', 'A', eerste)
    p.plan('b', 'B', tweede)
    expect(eerste).toHaveBeenCalledTimes(1)
    expect(tweede).not.toHaveBeenCalled()
    expect(p.actie?.id).toBe('b')
    expect(tm.open()).toBe(1)
  })

  it('flush voert nu uit en meldt de wijziging aan de UI', () => {
    const tm = maakTimer()
    const onWijziging = vi.fn()
    const uitvoeren = vi.fn()
    const p = new UitgesteldeActiePlanner({ ...tm, onWijziging })
    p.plan('a', 'A', uitvoeren)
    expect(onWijziging).toHaveBeenLastCalledWith({ id: 'a', label: 'A' })
    p.flush()
    expect(uitvoeren).toHaveBeenCalledTimes(1)
    expect(onWijziging).toHaveBeenLastCalledWith(null)
    p.flush()
    expect(uitvoeren).toHaveBeenCalledTimes(1)
  })

  it('geeft een fout in de uitvoering door zonder te crashen', async () => {
    const tm = maakTimer()
    const onFout = vi.fn()
    const p = new UitgesteldeActiePlanner({ ...tm, onFout })
    p.plan('a', 'A', () => { throw new Error('kapot') })
    tm.tik()
    expect(onFout).toHaveBeenCalledTimes(1)
    p.plan('b', 'B', () => Promise.reject(new Error('async kapot')))
    tm.tik()
    await Promise.resolve()
    expect(onFout).toHaveBeenCalledTimes(2)
    expect(onFout.mock.calls[1][1]).toEqual({ id: 'b', label: 'B' })
  })
})
