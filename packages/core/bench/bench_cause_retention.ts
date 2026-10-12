import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { parseArgs } from 'node:util'

// Avoid the public barrel's unrelated persistence/BroadcastChannel setup.
import { _read, action, atom, bind, context, notify } from '../src/core'
import { abortVar } from '../src/methods/abortVar'
import { isCausedBy } from '../src/methods/isCausedBy'

const { values } = parseArgs({
  options: {
    nodes: { type: 'string', default: '64' },
    rounds: { type: 'string', default: '4' },
    isolated: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
  },
})

function positiveInteger(text: string, option: string): number {
  const value = Number(text)
  assert.ok(
    Number.isSafeInteger(value) && value > 0,
    `--${option} must be a positive safe integer`,
  )
  return value
}

const nodeCount = positiveInteger(values.nodes, 'nodes')
const rounds = positiveInteger(values.rounds, 'rounds')
function requireGC() {
  const collect = globalThis.gc
  assert.ok(collect, 'Run with node --expose-gc --import=tsx')
  return collect
}

const gc = requireGC()
const root = values.isolated ? context.start() : context()
const collectionPasses = 8

type Mode = 'no-write' | 'ordinary' | 'root-bound'

function reatomNode(name: string) {
  const node = atom(0, name).extend((target) => ({
    // Keep a document-owned command as well as its atom, like draft.apply.
    commit: action((value: number) => target.set(value), `${name}.commit`),
  }))
  node()
  return node
}

type Node = ReturnType<typeof reatomNode>

function reatomActivation(node: Node, mode: Mode, round: number) {
  return abortVar.createAndRun(() => {
    const controller = abortVar.require()
    const input = atom(round + 1, `${node.name}.form.${round}.input`)
    const commit =
      mode === 'root-bound' ? bind(node.commit, context()) : node.commit
    const submit = action(() => {
      const value = input()
      return mode === 'no-write' ? value : commit(value)
    }, `${node.name}.form.${round}.submit`)

    try {
      submit()
      const frame = _read(node)
      assert.ok(frame)
      // Inspect immediately; never keep a frame or a strong form reference.
      assert.equal(isCausedBy(submit, Infinity, frame), mode === 'ordinary')
      return {
        round,
        input: new WeakRef(input),
        submit: new WeakRef(submit),
      }
    } finally {
      controller.abort('form activation ended')
    }
  })
}

type Reference = ReturnType<typeof reatomActivation>

async function collectGarbage() {
  // Leave the job that created or dereferenced WeakRefs before requesting GC.
  // Do not dereference between passes: deref keeps its target alive this job.
  for (let pass = 0; pass < collectionPasses; pass++) {
    await setImmediate()
    gc()
  }
  await setImmediate()
}

function countReachable(references: Reference[]) {
  let latestInputs = 0
  let earlierInputs = 0
  let submits = 0
  for (const reference of references) {
    if (reference.input.deref()) {
      if (reference.round === rounds - 1) latestInputs++
      else earlierInputs++
    }
    if (reference.submit.deref()) submits++
  }
  return { latestInputs, earlierInputs, submits }
}

async function measure(mode: Mode) {
  const nodes = root.run(() =>
    Array.from({ length: nodeCount }, (_, index) =>
      reatomNode(`${mode}.node.${index}`),
    ),
  )
  const references: Reference[] = []
  for (let round = 0; round < rounds; round++) {
    root.run(() => {
      for (const node of nodes) {
        references.push(reatomActivation(node, mode, round))
      }
      // Empty action call lists and queues before measuring retained causes.
      notify()
    })
  }

  await collectGarbage()
  const afterAbort = countReachable(references)
  // Read all surviving nodes after GC, not just their array's length.
  assert.deepEqual(
    root.run(() => nodes.map((node) => node())),
    Array(nodeCount).fill(mode === 'no-write' ? 0 : rounds),
  )

  if (mode !== 'ordinary') {
    assert.deepEqual(
      afterAbort,
      {
        latestInputs: 0,
        earlierInputs: 0,
        submits: 0,
      },
      `${mode} GC control failed; the run is inconclusive`,
    )
  }

  if (mode === 'ordinary') {
    root.run(() => {
      for (const node of nodes) node.set(rounds + 1)
      notify()
    })
    await collectGarbage()
    const afterAtomOverwrite = countReachable(references)

    root.run(() => {
      // An atom-only write does not replace the durable commit action's cause.
      for (const node of nodes) node.commit(rounds + 2)
      notify()
    })
    await collectGarbage()
    const afterCommandOverwrite = countReachable(references)
    assert.deepEqual(
      afterCommandOverwrite,
      {
        latestInputs: 0,
        earlierInputs: 0,
        submits: 0,
      },
      'Root command overwrite GC control failed; the run is inconclusive',
    )
    assert.deepEqual(
      root.run(() => nodes.map((node) => node())),
      Array(nodeCount).fill(rounds + 2),
    )

    console.table([
      { mode, phase: 'after abort + GC', ...afterAbort },
      { mode, phase: 'after root atom writes + GC', ...afterAtomOverwrite },
      { mode, phase: 'after root commit calls + GC', ...afterCommandOverwrite },
    ])
  } else {
    console.table([{ mode, phase: 'after abort + GC', ...afterAbort }])
  }
  return afterAbort
}

console.log(
  `Node ${process.version}; ${process.platform}/${process.arch}; ` +
    `${values.isolated ? 'isolated' : 'default'} context; ` +
    `${nodeCount} nodes; ${rounds} activations per node; ${collectionPasses} GC passes`,
)
await measure('no-write')
const ordinary = await measure('ordinary')
await measure('root-bound')

const retained =
  ordinary.latestInputs + ordinary.earlierInputs + ordinary.submits
console.log(
  `Ordinary writes retain ${retained} temporary input/action objects.`,
)
if (values.check && retained > 0) {
  console.error('Retention check failed: ended activations remain reachable.')
  process.exitCode = 1
}
