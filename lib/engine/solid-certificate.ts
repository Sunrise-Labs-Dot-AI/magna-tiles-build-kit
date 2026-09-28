import type { PrismPose } from "@/lib/magnetic-tiles/swept-prisms";

/** A value copy of every geometric input consumed by the solid checker. No
 * mutable pose references, rounding, sleep/mode heuristic or tolerance equality. */
export function solidCertificateIdentity(poses: PrismPose[], floor: number, tolerance: number): readonly (number|string)[] | undefined {
  const values: (number|string)[] = [floor,tolerance,poses.length];
  const vector = (v: {x:number;y:number;z:number}) => values.push(v.x,v.y,v.z);
  for (const pose of poses) {
    values.push(pose.tile.id,pose.tile.shape);
    vector(pose.tile.position); vector(pose.tile.rotation);
    values.push(Number(!!pose.tile.basis));
    if (pose.tile.basis) { vector(pose.tile.basis.xAxis); vector(pose.tile.basis.yAxis); vector(pose.tile.basis.zAxis); }
    values.push(pose.rotation.x,pose.rotation.y,pose.rotation.z,pose.rotation.w,pose.radius);
    vector(pose.min); vector(pose.max);
    for (const vectors of [pose.vertices,pose.edges,pose.normals]) {
      values.push(vectors.length); vectors.forEach(vector);
    }
  }
  return values.every(value => typeof value === "string" || Number.isFinite(value)) ? values : undefined;
}

export function sameSolidCertificate(a: readonly (number|string)[] | undefined, b: readonly (number|string)[] | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((value,i) => Object.is(value,b[i]));
}
