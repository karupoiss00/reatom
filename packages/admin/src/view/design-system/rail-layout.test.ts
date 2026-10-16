import { expect, test } from 'test'

import { layoutRailGraph, type RailInputNode } from './rail-layout'

function node(
  id: number,
  parentIds: Array<number>,
  timestamp = id * 10,
): RailInputNode {
  return {
    id,
    label: `atom${id}`,
    kind: 'state',
    timestamp,
    parentIds,
    hasError: false,
  }
}

function laneOf(layout: ReturnType<typeof layoutRailGraph>, id: number) {
  return layout.nodes.find((entry) => entry.id === id)?.lane
}

test('the path from the root to the selected frame is a straight lane 0', () => {
  const layout = layoutRailGraph([node(1, []), node(2, [1]), node(3, [2])], 3)

  expect([laneOf(layout, 1), laneOf(layout, 2), laneOf(layout, 3)]).toEqual([
    0, 0, 0,
  ])
  expect(layout.selectedPathIds).toEqual([1, 2, 3])
  expect(layout.nodes.map((entry) => entry.row)).toEqual([0, 1, 2])
  expect(layout.edges.every((edge) => edge.shape === 'straight')).toBe(true)
  expect(layout.edges.every((edge) => edge.isOnPath)).toBe(true)
})

test('a sibling branches into the next lane and the trunk stays straight', () => {
  const layout = layoutRailGraph(
    [node(1, []), node(2, [1]), node(3, [1]), node(4, [2])],
    4,
  )

  expect(laneOf(layout, 2)).toBe(0)
  expect(laneOf(layout, 3)).toBe(1)
  expect(
    layout.edges.find((edge) => edge.fromId === 1 && edge.toId === 3)?.shape,
  ).toBe('branch')
  expect(layout.nodes.find((entry) => entry.id === 3)?.relation).toBe('related')
})

test('lanes are reused once a branch ends', () => {
  const layout = layoutRailGraph(
    [
      node(1, []),
      node(2, [1]),
      node(3, [2]),
      node(4, [3]),
      node(5, [4]),
      node(6, [1], 15),
      node(7, [3], 35),
    ],
    5,
  )

  expect(laneOf(layout, 6)).toBe(1)
  expect(laneOf(layout, 7)).toBe(1)
  expect(layout.laneCount).toBe(2)
})

test('a fan-out of leaf effects shares one lane next to the parent', () => {
  const layout = layoutRailGraph(
    [node(1, []), node(2, [1]), node(3, [1]), node(4, [1]), node(5, [1])],
    1,
  )

  expect(layout.laneCount).toBe(2)
  expect(laneOf(layout, 5)).toBe(0)
  expect([laneOf(layout, 2), laneOf(layout, 3), laneOf(layout, 4)]).toEqual([
    1, 1, 1,
  ])
  expect(
    layout.edges
      .filter((edge) => edge.toId !== 5)
      .every((edge) => edge.shape === 'merge'),
  ).toBe(true)
  expect(layout.hiddenCount).toBe(0)
})

test('a second parent merges into the child lane', () => {
  const layout = layoutRailGraph(
    [node(1, []), node(2, [1]), node(3, [2]), node(4, [1]), node(5, [3, 4])],
    5,
  )

  expect(layout.selectedPathIds).toEqual([1, 4, 5])
  const merge = layout.edges.find((edge) => edge.fromId === 3)
  expect(merge?.shape).toBe('merge')
  expect(merge?.relation).toBe('cause')
  expect(merge?.fromLane === merge?.toLane).toBe(false)
  expect(layout.nodes.find((entry) => entry.id === 3)?.relation).toBe('cause')
})

test('selection splits nodes into causes and effects', () => {
  const layout = layoutRailGraph(
    [node(1, []), node(2, [1]), node(3, [2]), node(4, [3])],
    2,
  )

  expect(layout.nodes.map((entry) => entry.relation)).toEqual([
    'cause',
    'selected',
    'effect',
    'effect',
  ])
  expect(layout.selectedPathIds).toEqual([1, 2])
})

test('parents stay above children even when timestamps disagree', () => {
  const layout = layoutRailGraph([node(1, [], 50), node(2, [1], 10)], 2)

  expect(layout.nodes.map((entry) => entry.id)).toEqual([1, 2])
})

test('a caller path that is not a parent chain falls back to the shortest one', () => {
  const layout = layoutRailGraph(
    [node(1, []), node(2, [1]), node(3, [2])],
    3,
    [3, 1],
  )

  expect(layout.selectedPathIds).toEqual([1, 2, 3])
})

test('branches beyond the lane limit are hidden and counted', () => {
  const nodes = [
    node(1, []),
    node(2, [1]),
    node(3, [1]),
    node(4, [1]),
    node(5, [1]),
    node(6, [1]),
    node(7, [1]),
    node(8, [2]),
    node(9, [3, 4, 5, 6, 7]),
  ]
  const layout = layoutRailGraph(nodes, 8)

  expect(layout.laneCount).toBeLessThanOrEqual(5)
  expect(layout.hiddenCount).toBeGreaterThan(0)
  expect(layout.nodes.length + layout.hiddenCount).toBe(nodes.length)
  expect(layout.nodes.some((entry) => entry.id === 8)).toBe(true)
})
