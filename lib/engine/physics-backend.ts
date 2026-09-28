import Native, {
  ColliderDesc, JointData, RigidBodyDesc, Shape,
  type Collider, type ImpulseJoint, type RigidBody, type Vector,
} from "@magnatiles/rapier-contact";
import profile from "@/vendor/rapier-contact/profile.json";

export { ColliderDesc, JointData, RigidBodyDesc, ConvexPolyhedron, RigidBodyType, ShapeType, ActiveCollisionTypes } from "@magnatiles/rapier-contact";
export type { Collider, ImpulseJoint, RigidBody, TempContactManifold } from "@magnatiles/rapier-contact";

type Settings = typeof profile.defaults;
export function integrationSettings(world: { integrationParameters: Pick<Native.IntegrationParameters, keyof Settings> }): Settings {
  const p = world.integrationParameters;
  return { dt:p.dt,contact_erp:p.contact_erp,lengthUnit:p.lengthUnit,
    normalizedAllowedLinearError:p.normalizedAllowedLinearError,normalizedPredictionDistance:p.normalizedPredictionDistance,
    numSolverIterations:p.numSolverIterations,numInternalPgsIterations:p.numInternalPgsIterations,
    minIslandSize:p.minIslandSize,maxCcdSubsteps:p.maxCcdSubsteps };
}
export function assertIntegrationSettings(world: Native.World, configured = false): void {
  const expected = configured ? profile.configured : profile.defaults;
  const actual = integrationSettings(world);
  for (const key of Object.keys(expected) as (keyof Settings)[])
    if (actual[key] !== expected[key]) throw new Error(`Physics integration profile changed: ${key}`);
}

/** Keep the existing app's World API while guarding objects crossing into WASM.
 * The separate browser sandbox and unpatched controls cannot lend raw objects. */
export class World extends Native.World {
  private ownedBodies = new WeakSet<RigidBody>();
  private ownedColliders = new WeakSet<Collider>();
  private ownedJoints = new WeakSet<ImpulseJoint>();
  private disposed = false;

  constructor(gravity: Vector) {
    if (arguments.length !== 1 || !gravity || ![gravity.x,gravity.y,gravity.z].every(Number.isFinite))
      throw new Error("Physics World accepts finite gravity only, never raw subsystem objects");
    super(gravity);
    try { assertIntegrationSettings(this); }
    catch (error) { super.free(); throw error; }
  }
  private alive(): void {
    if (this.disposed) throw new Error("Physics world has been disposed");
  }
  private body(body: RigidBody): void {
    this.alive();
    if (!this.ownedBodies.has(body) || !body.isValid()) throw new Error("Body belongs to another or disposed physics world");
  }
  private collider(collider: Collider): void {
    this.alive();
    if (!this.ownedColliders.has(collider) || !collider.isValid()) throw new Error("Collider belongs to another or disposed physics world");
  }
  override createRigidBody(desc: RigidBodyDesc): RigidBody {
    this.alive();
    if (!(desc instanceof RigidBodyDesc)) throw new Error("Foreign or raw rigid-body descriptor");
    const body = super.createRigidBody(desc);
    this.ownedBodies.add(body);
    return body;
  }
  override createCollider(desc: ColliderDesc, parent?: RigidBody): Collider {
    this.alive();
    if (!(desc instanceof ColliderDesc) || !(desc.shape instanceof Shape)) throw new Error("Foreign or raw collider descriptor/shape");
    if (parent) this.body(parent);
    const collider = super.createCollider(desc,parent);
    this.ownedColliders.add(collider);
    const setShape = collider.setShape.bind(collider);
    collider.setShape = shape => {
      this.collider(collider);
      if (!(shape instanceof Shape)) throw new Error("Foreign or raw collider shape");
      setShape(shape);
    };
    return collider;
  }
  override createImpulseJoint(desc: JointData, a: RigidBody, b: RigidBody, wakeUp: boolean): ImpulseJoint {
    this.body(a); this.body(b);
    if (!(desc instanceof JointData)) throw new Error("Foreign or raw joint descriptor");
    const joint = super.createImpulseJoint(desc,a,b,wakeUp);
    this.ownedJoints.add(joint);
    return joint;
  }
  override createMultibodyJoint(): never {
    throw new Error("The headless verifier uses impulse joints only");
  }
  override removeRigidBody(body: RigidBody): void {
    this.body(body); super.removeRigidBody(body); this.ownedBodies.delete(body);
  }
  override removeCollider(collider: Collider, wakeUp: boolean): void {
    this.collider(collider); super.removeCollider(collider,wakeUp); this.ownedColliders.delete(collider);
  }
  override removeImpulseJoint(joint: ImpulseJoint, wakeUp: boolean): void {
    this.alive();
    if (!this.ownedJoints.has(joint) || !joint.isValid()) throw new Error("Joint belongs to another or disposed physics world");
    super.removeImpulseJoint(joint,wakeUp); this.ownedJoints.delete(joint);
  }
  override contactPair(...args: Parameters<Native.World["contactPair"]>): void {
    this.collider(args[0]); this.collider(args[1]); super.contactPair(...args);
  }
  override contactPairsWith(...args: Parameters<Native.World["contactPairsWith"]>): void {
    this.collider(args[0]); super.contactPairsWith(...args);
  }
  override step(): void {
    this.alive();
    if (arguments.length) throw new Error("The headless verifier accepts no external event queues or hooks");
    super.step();
  }
  override takeSnapshot(): never { throw new Error("Binary physics snapshots are disabled; use versioned EngineState"); }
  static override restoreSnapshot(): never { throw new Error("Binary physics snapshots are disabled; use versioned EngineState"); }
  override free(): void {
    if (this.disposed) return;
    super.free(); this.disposed = true;
    this.ownedBodies = new WeakSet(); this.ownedColliders = new WeakSet(); this.ownedJoints = new WeakSet();
  }
}

const RAPIER = { init: Native.init,World };
export default RAPIER;
