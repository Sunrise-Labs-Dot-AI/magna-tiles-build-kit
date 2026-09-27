import { assemble, square, v } from "@/lib/replication/geometry";
import { closedShell } from "./closed-shell";

export const flatContactFixture = () => assemble("flat-contact", "Flat square", [
  square("base", v(-1.5, .09, -1.5), v(3,0,0), v(0,0,3), "red", 1, "base"),
], "tower");

/** Five catalog squares: a horizontal base carries four connected upright walls.
 * This is an inverted independent shell, not geometry fitted to a source ramp. */
export function loadedContactFixture() {
  const flip = (p: {x:number;y:number;z:number}) => v(p.x, -p.y, -p.z);
  return assemble("loaded-base-contact", "Loaded square base", closedShell(1).tiles.map(t => ({
    ...t, step: 1, position: v(t.position.x, 3.18-t.position.y, -t.position.z),
    basis: { xAxis: flip(t.basis!.xAxis), yAxis: flip(t.basis!.yAxis), zAxis: flip(t.basis!.zAxis) },
  })), "tower");
}

/** Wall above the horizontal leaf: gravity folds the leaf away from the wall.
 * An upright wall under a roof can mechanically bear the roof's finite edge. */
export function unsupportedHingeFixture() {
  const flip = (p: {x:number;y:number;z:number}) => v(p.x,-p.y,-p.z);
  return assemble("unsupported-hinge", "Free downward hinge", closedShell(1).tiles.filter(t => ["roof","x-0--1"].includes(t.id)).map(t => ({
    ...t, position: v(t.position.x,10-t.position.y,-t.position.z),
    basis: {xAxis:flip(t.basis!.xAxis),yAxis:flip(t.basis!.yAxis),zAxis:flip(t.basis!.zAxis)},
  })),"tower");
}
