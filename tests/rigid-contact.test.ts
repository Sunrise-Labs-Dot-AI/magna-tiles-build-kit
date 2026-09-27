import { describe, expect, it, vi } from "vitest";
import { RigidBodyType } from "@/lib/engine/physics-backend";
import { createEngineWorld, perturbFirstRelease } from "@/lib/engine/rapier-world";
import { validateMagneticBuild } from "@/lib/engine/build";
import { validateEngineInput } from "@/lib/engine/input";
import { findRawOverlaps, RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import { CONTACT_NATURAL_FREQUENCY_HZ, SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED } from "@/lib/engine/constants";
import { gravityVector } from "@/lib/engine/physics-model";
import { flatContactFixture, loadedContactFixture, unsupportedHingeFixture } from "./fixtures/rigid-contact";
import legacyWideRamp from "@/build-drafts/large-car-ramp.json";
import { assemble } from "@/lib/replication/geometry";
import type { TileInstance } from "@/lib/magnetic-tiles/types";

describe("independent rigid table contact", () => {
  it.each([flatContactFixture, loadedContactFixture])("uses rigid catalog panels with valid joins and no overlap: %s", fixture => {
    const build = fixture();
    expect(validateEngineInput(build)).toEqual([]);
    expect(validateMagneticBuild(build).rejectedReasons).toEqual([]);
    expect(findRawOverlaps(build.tiles)).toEqual([]);
  });
  it.each([0,17,53])("converges under step/solver refinement for seed %i", async seed => {
    for (const fixture of [flatContactFixture, loadedContactFixture]) for (const hz of [960,1920]) for (const solver of [16,32]) {
      const engine = await createEngineWorld(fixture(), {drop:true, floorY:0});
      try {
        const params = engine.world.integrationParameters;
        const omega = 2*Math.PI*CONTACT_NATURAL_FREQUENCY_HZ;
        expect(params.contact_erp).toBeCloseTo(params.dt*omega/(params.dt*omega+10));
        expect(params.lengthUnit).toBe(1);
        expect(params.normalizedAllowedLinearError).toBeCloseTo(.001);
        params.dt = 1/hz; params.numSolverIterations = solver;
        [...engine.bodies.values()].forEach((r,i) => perturbFirstRelease(r,i,seed));
        let rest = 0, latePeak = 0;
        for (let i = 0; i < hz*7.5; i++) {
          engine.step();
          if (i >= hz*6.75) latePeak = Math.max(latePeak, engine.groundPenetration);
          if ((i+1) % (hz/120) === 0) rest = engine.stepSpeeds.linear < SETTLED_LINEAR_SPEED && engine.stepSpeeds.angular < SETTLED_ANGULAR_SPEED ? rest+1 : 0;
        }
        const context = `${fixture.name}/${hz}/${solver}/${seed}`;
        expect(engine.invalidState,context).toBe(false);
        expect(engine.solidFailures,context).toEqual([]);
        expect(engine.peakGroundPenetration,context).toBeLessThanOrEqual(RAW_OVERLAP_TOLERANCE);
        expect(engine.peakDisplacement,context).toBeLessThan(.95);
        expect(engine.poppedJoints,context).toEqual([]);
        expect(rest,context).toBeGreaterThanOrEqual(90);
        expect(latePeak,context).toBeLessThanOrEqual(.01);
      } finally { engine.dispose(); }
    }
  }, 120_000);
  it("retains a table penetration after the panel recovers", async () => {
    const e = await createEngineWorld(flatContactFixture(), {drop:false, floorY:0});
    try {
      const b = [...e.bodies.values()][0].body;
      b.setBodyType(RigidBodyType.Fixed,true);
      b.setTranslation({x:0,y:-.2,z:0},true); e.step();
      expect(e.peakGroundPenetration).toBeGreaterThan(.28);
      const peak=e.peakGroundPenetration;
      b.setTranslation({x:0,y:1,z:0},true); e.step();
      expect(e.peakGroundPenetration).toBe(peak);
    } finally {e.dispose();}
  });
  it("resolves an inclined-panel impact under further timestep refinement", async () => {
    // Independent legacy geometry: one wide plate and two triangular supports.
    // Coarse 480 Hz diagnostics penetrated 0.038–0.040 in; no source fit is used.
    const build=assemble("inclined-contact","Inclined contact",(legacyWideRamp.tiles as TileInstance[]).filter(t=>/wedge|sloped-driving/.test(t.id)).map(t=>({...t,step:1})),"ramp");
    expect(validateEngineInput(build)).toEqual([]);
    expect(findRawOverlaps(build.tiles)).toEqual([]);
    expect(validateMagneticBuild(build).rejectedReasons).toEqual([]);
    for(const hz of [960,1920]) for(const seed of [0,17,53]) {
      const e=await createEngineWorld(build,{drop:true});
      try {
        e.world.integrationParameters.dt=1/hz;
        [...e.bodies.values()].forEach((r,i)=>perturbFirstRelease(r,i,seed));
        let rest=0;
        for(let n=0;n<7.5*hz;n++) {e.step();rest=e.stepSpeeds.linear<SETTLED_LINEAR_SPEED&&e.stepSpeeds.angular<SETTLED_ANGULAR_SPEED?rest+1:0;}
        expect(e.peakGroundPenetration,`${hz}/${seed}`).toBeLessThanOrEqual(.03);
        expect(e.peakDisplacement).toBeLessThanOrEqual(.95);
        expect(rest/hz).toBeGreaterThanOrEqual(.75);
        expect(e.poppedJoints).toEqual([]);
        expect(e.invalidState).toBe(false);
        expect(e.solidFailures).toEqual([]);
      } finally {e.dispose();}
    }
  });
  it("stops at a failed collision step before a later endpoint could recover", async () => {
    const e = await createEngineWorld(flatContactFixture(), {drop:false,floorY:0});
    try {
      const b=[...e.bodies.values()][0].body;
      b.setBodyType(RigidBodyType.Fixed,true);
      let step=0;
      vi.spyOn(e.world,"step").mockImplementation(() => { b.setTranslation({x:0,y:++step===2?-.2:.09,z:0},true); });
      e.step();
      expect(step).toBe(2);
      expect(b.translation().y).toBeCloseTo(-.2);
      expect(e.peakGroundPenetration).toBeGreaterThan(.28);
      expect(e.solidFailures[0].kind).toBe("table");
      e.step();expect(step).toBe(2);
    } finally {e.dispose();}
  });
  it("rejects nonfinite body state before advancing dynamics", async () => {
    const e=await createEngineWorld(flatContactFixture(),{drop:false});
    try {
      const b=[...e.bodies.values()][0].body;
      vi.spyOn(b,"linvel").mockReturnValue({x:NaN,y:0,z:0});
      const step=vi.spyOn(e.world,"step"); e.step();
      expect(step).not.toHaveBeenCalled();
      expect(e.invalidState).toBe(true);
      expect(e.peakGroundPenetration).toBe(Infinity);
    } finally {e.dispose();}
  });
  it("preserves elapsed gravity time and the caller's timestep", async () => {
    const e=await createEngineWorld(flatContactFixture(),{drop:false,floorY:-100});
    try {
      const b=[...e.bodies.values()][0].body;
      b.setLinvel({x:0,y:0,z:0},true);
      const dt=e.world.integrationParameters.dt;
      for(let n=0;n<12;n++) e.step();
      expect(b.linvel().y).toBeCloseTo(gravityVector().y*.1,3);
      expect(e.world.integrationParameters.dt).toBe(dt);
    } finally {e.dispose();}
  });
  it("interpolates a held body's requested path across substeps", async () => {
    const e=await createEngineWorld(flatContactFixture(),{drop:false,floorY:-100});
    try {
      const b=[...e.bodies.values()][0].body, start={...b.translation()};
      b.setBodyType(RigidBodyType.KinematicPositionBased,true);
      b.setNextKinematicTranslation({...start,x:start.x+1});
      b.setNextKinematicRotation({x:0,y:1,z:0,w:0});
      const positions:number[]=[], rotations:number[]=[];
      const original=e.world.step.bind(e.world);
      vi.spyOn(e.world,"step").mockImplementation(() => {original();positions.push(b.translation().x-start.x); rotations.push(b.rotation().y);});
      e.step();
      expect(positions).toEqual([.125,.25,.375,.5,.625,.75,.875,1]);
      expect(rotations[3]).toBeCloseTo(Math.SQRT1_2);
      expect(rotations[7]).toBeCloseTo(1);
    } finally {e.dispose();}
  });
  it("uses microstep time for the same magnetic break under coarse/refined reporting", async () => {
    const results = [];
    for (const hz of [120,480]) {
      const e = await createEngineWorld(unsupportedHingeFixture(),{drop:false,floorY:0});
      try {
        e.world.integrationParameters.dt=1/hz;
        for (const {body} of e.bodies.values()) body.setBodyType(RigidBodyType.Fixed,true);
        const from=e.bodies.get(e.joints[0].model.fromTileId)!.body, start={...from.translation()};
        let seconds=0;
        vi.spyOn(e.world,"step").mockImplementation(() => {
          seconds+=e.world.integrationParameters.dt;
          from.setTranslation({...start,x:start.x+10*seconds},true);
        });
        for (let n=0;n<hz/120;n++) e.step();
        results.push(e.poppedJoints);
        expect(e.poppedJoints).toHaveLength(1);
      } finally {e.dispose();}
    }
    expect(results[0]).toEqual(results[1]);
  });
});
