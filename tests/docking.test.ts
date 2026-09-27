import { describe, expect, it } from "vitest";
import { add, magnitude, transformLocal } from "@/lib/engine/math";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { dockToSupports } from "@/lib/replication/docking";
import { assemblyUFixture } from "./fixtures/assembly";
import { exactPrismDepth } from "./fixtures/contact-frames";

describe("docking follows actual supports without changing solids", () => {
  it.each([0,1e-7])("continues past shallow overlap to a viable target with %s radians of tilt", tilt => {
    const r = assemblyUFixture(), nominal = structuredClone(r.build);
    const ids = nominal.tiles.map(t => t.id), incomingId = ids[2];
    const rotate = (axis: { x: number; y: number; z: number }) =>
      transformLocal(axis,{ x: 0,y: 0,z: 0 },basisFromEuler(tilt,0,0));
    const actual = { ...nominal, tiles: nominal.tiles.map(t => t.id === incomingId
      ? { ...t, position: add(t.position,{ x: -.015,y: 0,z: -.015 }),basis: {
        xAxis: rotate(t.basis!.xAxis),yAxis: rotate(t.basis!.yAxis),zAxis: rotate(t.basis!.zAxis),
      } } : t) };
    const before = structuredClone(actual);
    expect(exactPrismDepth(actual.tiles[1],actual.tiles[2])).toBeGreaterThan(.01);
    const result = dockToSupports(nominal,actual,[incomingId],ids.slice(0,2),r.construction![0].operations[2].hands!,0,"clear-first");
    expect(result.status,result.detail).toBe("pass");
    expect(result.targetPenetration).toBeLessThan(1e-7);
    expect(result.offset).not.toEqual({ x: 0,y: 0,z: 0 });
    expect(magnitude(result.offset)).toBeCloseTo(.03,8);
    for (const installed of result.build.tiles.slice(0,2)) {
      expect(exactPrismDepth(installed,result.build.tiles[2])).toBeLessThan(1e-7);
    }
    expect(result.build.tiles.slice(0,2)).toEqual(before.tiles.slice(0,2));
    expect(result.build.tiles[2].basis).toEqual(before.tiles[2].basis);
    expect(actual).toEqual(before);
    expect(r.build).toEqual(nominal);
  });

  it("preserves existing within-component overlap under the original dynamic allowance", () => {
    const r = assemblyUFixture(), ids = r.build.tiles.map(t => t.id);
    const actual = { ...r.build,tiles: r.build.tiles.map((t,i) => i === 0
      ? { ...t,position: add(t.position,{ x: .01,y: 0,z: -.01 }) } : t) };
    expect(exactPrismDepth(actual.tiles[0],actual.tiles[1])).toBeGreaterThan(.005);
    const result = dockToSupports(r.build,actual,[ids[2]],ids.slice(0,2),r.construction![0].operations[2].hands!,0,"clear-first");
    expect(result.status,result.detail).toBe("pass");
    expect(result.build.tiles.slice(0,2)).toEqual(actual.tiles.slice(0,2));
  });

  it("rejects every grid target contained in an unjoined installed blocker", () => {
    const r = assemblyUFixture(), ids = r.build.tiles.map(t => t.id);
    const blocker = { ...r.build.tiles[2],id: "unjoined-blocker",shape: "large-square" as const };
    const actual = { ...r.build,tiles: [...r.build.tiles,blocker] };
    const result = dockToSupports(actual,actual,[ids[2]],[...ids.slice(0,2),blocker.id],r.construction![0].operations[2].hands!,-3,"clear-first");
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("excessive incoming-versus-installed solid penetration");
    expect(result.targetPenetration).toBeNull();
  });

  it("moves only the incoming panel and preserves the nominal source model", () => {
    const r = assemblyUFixture(), nominal = structuredClone(r.build), ids = nominal.tiles.map(t => t.id);
    const actual = { ...nominal, tiles: nominal.tiles.map(t => t.id === ids[2] ? t : { ...t,position: add(t.position,{ x: .2,y: 0,z: .1 }) }) };
    const result = dockToSupports(nominal,actual,[ids[2]],ids.slice(0,2),r.construction![0].operations[2].hands!,0,"clear-first");
    expect(result.status,result.detail).toBe("pass");
    expect(result.offset.x).toBeCloseTo(.2);
    expect(result.offset.z).toBeCloseTo(.1);
    expect(result.build.tiles.slice(0,2)).toEqual(actual.tiles.slice(0,2));
    expect(result.build.tiles[2].basis).toEqual(nominal.tiles[2].basis);
    expect(r.build).toEqual(nominal);
  });
  it.each(["excessive-shift","table","blocked-grip"])("rejects %s", mode => {
    const r = assemblyUFixture(), ids = r.build.tiles.map(t => t.id), hands = structuredClone(r.construction![0].operations[2].hands!);
    const actual = { ...r.build,tiles: r.build.tiles.map(t => ids.slice(0,2).includes(t.id) ? { ...t,position: add(t.position,{ x: mode === "excessive-shift" ? 4 : .1,y: mode === "table" ? -.5 : 0,z: 0 }) } : t) };
    if (mode === "blocked-grip") hands[0].localPoint.x = 99;
    expect(dockToSupports(r.build,actual,[ids[2]],ids.slice(0,2),hands,0,"clear-first").status).toBe("fail");
  });
});
