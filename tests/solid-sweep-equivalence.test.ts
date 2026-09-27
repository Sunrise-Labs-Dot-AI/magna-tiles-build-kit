import { describe, expect, it } from "vitest";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { checkSolidSweep, prismPose } from "@/lib/magnetic-tiles/swept-prisms";
import * as baseline from "./fixtures/solid-sweep-oracle";
import { square, v } from "@/lib/replication/geometry";
import type { TileInstance, TileShape } from "@/lib/magnetic-tiles/types";

const panel = (id: string, z=0, y=5) => square(id,v(-1.5,y-1.5,z),v(3,0,0),v(0,3,0),"red",1,"fixture");
function equivalent(before: TileInstance[], after=before, floor=0) {
  let currentCalls=0, baselineCalls=0;
  const actual=checkSolidSweep(before.map(prismPose),after.map(prismPose),floor,.03,()=>{currentCalls++;});
  const expected=baseline.checkSolidSweep(before.map(baseline.prismPose),after.map(baseline.prismPose),floor,.03,()=>{baselineCalls++;});
  expect(actual).toEqual(expected);
  expect(currentCalls).toBe(baselineCalls);
  return actual;
}

describe("solid-sweep optimization preserves the frozen acceptance contract",()=>{
  it("matches complete payloads and budget checkpoints on analytic boundary cases",()=>{
    for(const z of [0,.047321,.15-2e-9,.15-5e-10,.15,.15+1e-12,.18,.18000001,1]) {
      const a=panel("a"), b=panel("b",z);
      equivalent([a,b]);
      equivalent([a,b],[a,{...b,position:v(.25,5,z)}]);
    }
    const a=panel("a"),wall={...panel("wall"),position:v(3.1,5,0)};
    expect(equivalent([a,wall],[{...a,basis:basisFromEuler(0,0,Math.PI)},wall]).failure?.kind).toBe("overlap");
    const low={...a,position:v(0,1.7,0)};
    expect(equivalent([low],[{...low,basis:basisFromEuler(0,0,Math.PI)}]).failure?.kind).toBe("table");
    expect(equivalent([a,panel("cross",-1)],[a,panel("cross",1)]).failure?.kind).toBe("overlap");
    const inside={...panel("inside"),shape:"equilateral-triangle" as const};
    expect(equivalent([{...a,shape:"xl-square"},inside]).failure?.kind).toBe("overlap");
    equivalent([a,panel("b",.14)],[a,{...panel("b",.14),basis:basisFromEuler(1e-7,0,0)}]);
  });

  it("matches seeded moving scenes without cross-call or reversed-pair cache reuse",()=>{
    let seed=0x54729431;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    const shapes:TileShape[]=["small-square","xl-square","equilateral-triangle","right-triangle","isosceles-triangle"];
    const seen=new Set<string>();
    for(let n=0;n<600;n++) {
      const before=Array.from({length:2+n%3},(_,i)=>({...panel(`p${i}`),shape:shapes[(n+i)%shapes.length],
        position:v((random()-.5)*10,random()*7,(random()-.5)*10),
        basis:basisFromEuler(random()*Math.PI,random()*Math.PI,random()*Math.PI)}));
      const after=before.map(t=>({...t,position:v(t.position.x+(random()-.5)*3,t.position.y+(random()-.5)*3,t.position.z+(random()-.5)*3),
        basis:basisFromEuler(random()*Math.PI,random()*Math.PI,random()*Math.PI)}));
      for(const order of [false,true]) {
        const a=order?[...before].reverse():before,b=order?[...after].reverse():after;
        seen.add(equivalent(a,b,n%2 ? -100:0).failure?.kind??"clear");
      }
    }
    expect(seen.has("clear")).toBe(true);expect(seen.has("overlap")).toBe(true);expect(seen.has("table")).toBe(true);
  });

  it("throws the same budget exception at every checkpoint of an ambiguous sweep",()=>{
    const a=[panel("a"),panel("b",.15)],b=[a[0],{...a[1],position:v(.25,5,.15)}];
    expect(equivalent(a,b).failure?.kind).toBe("uncertified-sweep");
    let total=0;
    baseline.checkSolidSweep(a.map(baseline.prismPose),b.map(baseline.prismPose),0,.03,()=>{total++;});
    expect(total).toBeGreaterThan(12);
    for(let limit=1;limit<=total;limit++) {
      for(const implementation of [{checkSolidSweep,prismPose},baseline]) {
        let calls=0;const error=new Error(`budget ${limit}`);
        expect(()=>implementation.checkSolidSweep(a.map(implementation.prismPose),b.map(implementation.prismPose),0,.03,()=>{if(++calls===limit)throw error;})).toThrow(error);
        expect(calls).toBe(limit);
      }
    }
  });

  it("retains malformed lineage failure before requesting computation",()=>{
    const before=[panel("a")],after=[panel("different")];
    equivalent(before,after);equivalent(before,[]);equivalent(before,before,NaN);
  });
});
