// Amanatides & Woo voxel DDA. Returns the first non-air voxel along the ray plus
// the face normal, which is what block placement needs.

import { AIR, isLiquid } from './blocks.js?v=20';

export function raycastVoxel(world, origin, direction, maxDistance = 6, skipLiquid = true) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);

  const dx = direction.x, dy = direction.y, dz = direction.z;
  const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);

  // Distance along the ray between successive grid planes on each axis.
  const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);

  const boundary = (p, i, step) => (step > 0 ? i + 1 - p : p - i);
  let tMaxX = dx === 0 ? Infinity : boundary(origin.x, x, stepX) * tDeltaX;
  let tMaxY = dy === 0 ? Infinity : boundary(origin.y, y, stepY) * tDeltaY;
  let tMaxZ = dz === 0 ? Infinity : boundary(origin.z, z, stepZ) * tDeltaZ;

  let normal = [0, 0, 0];
  let t = 0;

  while (t <= maxDistance) {
    const id = world.get(x, y, z);
    if (id !== AIR && !(skipLiquid && isLiquid(id))) {
      return { x, y, z, id, normal, distance: t };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; normal = [0, -stepY, 0];
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; normal = [0, 0, -stepZ];
    }
  }
  return null;
}
