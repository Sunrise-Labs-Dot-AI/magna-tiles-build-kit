import { describe, expect, it } from "vitest";
import { add, transformLocal } from "@/lib/engine/math";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { assemble, rigidPanel, square, v } from "@/lib/replication/geometry";
import { checkSupportFingerClearance, edgeGrips } from "@/lib/replication/grip";

describe("triangular finger obstacles have an interior reference point", () => {
  it.each([0,.1,.2,.4,.7,1.2,2.1,3.2])("keeps occupied and clear regions invariant under a %f rad rotation", angle => {
    // A right triangle's catalog origin is ON its hypotenuse. Interior (1,1)
    // and exterior (2.5,2.5) must not swap when that origin rounds to either side.
    const basis=basisFromEuler(.17,.23,angle),offset=v(7,10,-4);
    const point=(p:ReturnType<typeof v>)=>add(offset,transformLocal(p,v(0,0,0),basis));
    const obstacle=rigidPanel("triangle","right-triangle",[v(0,0,.31),v(3,0,.31),v(0,3,.31)].map(point),"green",1,"obstacle");
    for(const inside of [true,false]) {
      const p=inside?v(1,1,0):v(2.5,2.5,0);
      const original=square("held",add(p,v(-1.5,0,0)),v(3,0,0),v(0,3,0),"red",1,"held");
      const held={...original,position:point(original.position),basis};
      const graph=assemble("finger-test","Finger obstacle",[held,obstacle],"tower");
      const result=checkSupportFingerClearance(graph,[edgeGrips(held)[0]],-100);
      expect(result.status,`${angle}: ${inside}: ${result.detail}`).toBe(inside?"fail":"pass");
    }
  });
});
