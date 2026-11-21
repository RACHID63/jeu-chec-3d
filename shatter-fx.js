/**
 * Effet de destruction physique en ~45 éclats 3D polygonaux + onde de choc
 * lumineuse lors de la capture d'une pièce (prise normale ou en passant).
 */

import * as THREE from 'three';
import { BOARD_TOP_Y } from './pieces-3d.js';

export class ShatterFXManager {
  constructor(scene) {
    this.scene = scene;
    this.activeBursts = [];
    this._shardGeoA = new THREE.TetrahedronGeometry(0.085, 0);
    this._shardGeoB = new THREE.OctahedronGeometry(0.072, 0);
  }

  /**
   * Déclenche une explosion de 45 éclats polygonaux et une onde de choc circulaire.
   */
  spawnShatter(worldPos, capturedColor) {
    const shardCount = 46;
    const isWhite = capturedColor === 'w';

    // Matériaux des éclats reprenant fidèlement le matériau détruit
    const mainPalette = isWhite
      ? [0xfaf8f3, 0xe7dfd0, 0xc7bda9]
      : [0x241c16, 0x4b3c2e, 0x3f6f61, 0x5a9181];
    const goldColor = 0xd4af37;

    const shards = [];
    const burstGroup = new THREE.Group();
    this.scene.add(burstGroup);

    // Créer 4 matériaux clonables pour gérer le fondu sans fuite mémoire
    const burstMaterials = mainPalette.map(
      (hex) =>
        new THREE.MeshStandardMaterial({
          color: hex,
          roughness: isWhite ? 0.28 : 0.36,
          metalness: isWhite ? 0.05 : 0.8,
          transparent: true,
          opacity: 1,
        })
    );
    const goldMat = new THREE.MeshStandardMaterial({
      color: goldColor,
      roughness: 0.24,
      metalness: 0.92,
      transparent: true,
      opacity: 1,
    });
    burstMaterials.push(goldMat);

    for (let i = 0; i < shardCount; i++) {
      const useGold = i % 6 === 0;
      const mat = useGold
        ? goldMat
        : burstMaterials[i % (burstMaterials.length - 1)];
      const geo = i % 2 === 0 ? this._shardGeoA : this._shardGeoB;

      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;

      // Répartition sur le volume vertical de la pièce capturée
      const angle = Math.random() * Math.PI * 2;
      const radialOffset = Math.random() * 0.22;
      const heightOffset = 0.14 + Math.random() * 0.92;

      mesh.position.set(
        worldPos.x + Math.cos(angle) * radialOffset,
        BOARD_TOP_Y + heightOffset,
        worldPos.z + Math.sin(angle) * radialOffset
      );

      // Échelle irrégulière pour former des éclats tranchants
      mesh.scale.set(
        0.55 + Math.random() * 1.15,
        0.45 + Math.random() * 1.35,
        0.4 + Math.random() * 0.9
      );
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      const speed = 1.8 + Math.random() * 3.4;
      const vx = Math.cos(angle) * speed;
      const vz = Math.sin(angle) * speed;
      const vy = 2.4 + Math.random() * 4.4;

      shards.push({
        mesh,
        vx,
        vy,
        vz,
        rx: (Math.random() - 0.5) * 14,
        ry: (Math.random() - 0.5) * 14,
        rz: (Math.random() - 0.5) * 14,
        radius: 0.048,
      });

      burstGroup.add(mesh);
    }

    // Onde de choc circulaire lumineuse au sol
    const ringGeo = new THREE.RingGeometry(0.18, 0.30, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: isWhite ? 0xf3e5ab : 0x5a9181,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const shockwave = new THREE.Mesh(ringGeo, ringMat);
    shockwave.position.set(worldPos.x, BOARD_TOP_Y + 0.014, worldPos.z);
    burstGroup.add(shockwave);

    this.activeBursts.push({
      group: burstGroup,
      shards,
      burstMaterials,
      shockwave,
      ringGeo,
      ringMat,
      age: 0,
      duration: 1.55,
    });
  }

  hasActive() {
    return this.activeBursts.length > 0;
  }

  update(dt) {
    if (this.activeBursts.length === 0) return;

    const gravity = -22.0;

    for (let b = this.activeBursts.length - 1; b >= 0; b--) {
      const burst = this.activeBursts[b];
      burst.age += dt;
      const progress = burst.age / burst.duration;

      // Onde de choc : expansion rapide + fondu sur 0.55s
      const ringProgress = Math.min(1, burst.age / 0.55);
      const scale = 1.0 + ringProgress * 3.8;
      burst.shockwave.scale.set(scale, 1, scale);
      burst.ringMat.opacity = Math.max(0, (1 - ringProgress) * 0.85);

      // Physique des éclats
      const fadeOpacity = progress > 0.55 ? Math.max(0, 1 - (progress - 0.55) / 0.45) : 1;
      for (let m = 0; m < burst.burstMaterials.length; m++) {
        burst.burstMaterials[m].opacity = fadeOpacity;
      }

      for (let i = 0; i < burst.shards.length; i++) {
        const s = burst.shards[i];
        s.vy += gravity * dt;
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;

        s.mesh.rotation.x += s.rx * dt;
        s.mesh.rotation.y += s.ry * dt;
        s.mesh.rotation.z += s.rz * dt;

        // Rebond amorti sur le plateau (y >= BOARD_TOP_Y)
        const floorY = BOARD_TOP_Y + s.radius;
        if (s.mesh.position.y < floorY) {
          s.mesh.position.y = floorY;
          if (Math.abs(s.vy) > 0.65) {
            s.vy = -s.vy * 0.42;
            s.vx *= 0.78;
            s.vz *= 0.78;
            s.rx *= 0.7;
            s.ry *= 0.7;
            s.rz *= 0.7;
          } else {
            s.vy = 0;
            s.vx *= 0.86;
            s.vz *= 0.86;
            s.rx *= 0.8;
            s.ry *= 0.8;
            s.rz *= 0.8;
          }
        }
      }

      // Nettoyage complet en fin de cycle
      if (burst.age >= burst.duration) {
        this.scene.remove(burst.group);
        for (const mat of burst.burstMaterials) mat.dispose();
        burst.ringGeo.dispose();
        burst.ringMat.dispose();
        this.activeBursts.splice(b, 1);
      }
    }
  }
}
