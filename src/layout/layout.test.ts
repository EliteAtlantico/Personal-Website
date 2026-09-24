import { describe, expect, test } from 'bun:test'
import { carve, circleObstacle, coverBand, crossSection, insideBand, rotatedRect } from './geometry'
import { pack } from './masonry'

describe('geometry', () => {
  test('carve splits a line around blocked ranges and drops slivers', () => {
    expect(carve({ left: 0, right: 300 }, [{ left: 100, right: 180 }])).toEqual([
      { left: 0, right: 100 },
      { left: 180, right: 300 },
    ])
    expect(carve({ left: 0, right: 300 }, [{ left: 10, right: 290 }], 24)).toEqual([])
    expect(carve({ left: 0, right: 300 }, [null, { left: 400, right: 500 }])).toEqual([{ left: 0, right: 300 }])
  })

  test('a circle blocks its widest chord within the band', () => {
    const hole = circleObstacle(100, 100, 50)
    expect(hole.band(90, 110)).toEqual({ left: 50, right: 150 })
    expect(hole.band(0, 20)).toBeNull()
    const edge = hole.band(130, 150)!
    expect(edge.left).toBeCloseTo(100 - 40)
  })

  test('silhouettes: text stays inside a chamfered corner for the whole line', () => {
    const chip = [
      { x: 30, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
      { x: 0, y: 30 },
    ]
    expect(crossSection(chip, 100)).toEqual({ left: 0, right: 200 })
    // Band 0–20 sits in the chamfer: the inside range starts where the chamfer is at y=0.
    expect(insideBand(chip, 0, 20)!.left).toBeCloseTo(30)
    expect(insideBand(chip, 40, 60)).toEqual({ left: 0, right: 200 })
  })

  test('a rotated rectangle blocks more width than its footprint', () => {
    const board = rotatedRect(100, 100, 100, 50, 30)
    const blocked = coverBand(board, 120, 130)!
    expect(blocked.right - blocked.left).toBeGreaterThan(50)
  })
})

describe('masonry', () => {
  test('packs in order, each tile under the lowest column', () => {
    const { placements, height } = pack(
      [
        { span: 1, height: 100 },
        { span: 1, height: 50 },
        { span: 1, height: 80 },
        { span: 1, height: 30 },
      ],
      3,
      200,
    )
    expect(placements.map((p) => [p.col, p.y])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 50],
    ])
    expect(height).toBe(100)
  })

  test('spanning tiles sit below every column they cover', () => {
    const { placements } = pack(
      [
        { span: 1, height: 100 },
        { span: 1, height: 40 },
        { span: 2, height: 60 },
      ],
      3,
      100,
    )
    expect(placements[2]).toMatchObject({ col: 1, y: 40, width: 200 })
  })

  test('feathering spreads leftover depth between stories, capped', () => {
    const { placements } = pack(
      [
        { span: 1, height: 200 },
        { span: 1, height: 60 },
        { span: 1, height: 60 },
      ],
      2,
      100,
      50,
    )
    // Column 1 is 80px short: its second story moves down by up to the 50px cap.
    expect(placements[2]!.y).toBe(60 + 50)
  })
})
