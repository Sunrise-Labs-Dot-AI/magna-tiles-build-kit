import { describe, expect, it } from "vitest";
import { add } from "@/lib/engine/math";
import { dockToSupports } from "@/lib/replication/docking";
import { assemblyUFixture } from "./fixtures/assembly";

describe("docking follows actual supports without changing solids", () => {
  it("moves only the incoming panel and preserves the nominal source model", () => {
    const r = assemblyUFixture(), nominal = structuredClone(r.build), ids = nominal.tiles.map(t => t.id);
    const actual = { ...nominal, tiles: nominal.tiles.map(t => t.id === ids[2] ? t : { ...t,position: add(t.position,{ x: .2,y: 0,z: .1 }) }) };
    const result = dockToSupports(nominal,actual,[ids[2]],ids.slice(0,2),r.construction![0].operations[2].hands!,0);
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
    expect(dockToSupports(r.build,actual,[ids[2]],ids.slice(0,2),hands,0).status).toBe("fail");
  });
});
