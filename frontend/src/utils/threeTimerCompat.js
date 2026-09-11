/**
 * AeroMesh THREE.Timer Compatibility Module
 *
 * Implements the Clock interface directly on top of the recommended THREE.Timer API,
 * providing seamless delta timing, elapsed timing, and animation frame updates
 * for libraries (such as @react-three/fiber) while eliminating the THREE.Clock deprecation warning.
 */

import * as THREE from 'three/src/Three.js';
import { Timer } from 'three/src/Three.js';

export class TimerClock {
  constructor(autoStart = true) {
    this.autoStart = autoStart;
    this.timer = new Timer();
    this.startTime = 0;
    this.oldTime = 0;
    this.elapsedTime = 0;
    this.running = false;
    if (autoStart) {
      this.start();
    }
  }

  start() {
    this.startTime = performance.now();
    this.oldTime = this.startTime;
    this.elapsedTime = 0;
    this.running = true;
    this.timer.reset();
  }

  stop() {
    this.getElapsedTime();
    this.running = false;
    this.autoStart = false;
  }

  getElapsedTime() {
    this.getDelta();
    return this.elapsedTime;
  }

  getDelta() {
    let diff = 0;
    if (this.autoStart && !this.running) {
      this.start();
      return 0;
    }
    if (this.running) {
      this.timer.update();
      diff = this.timer.getDelta();
      this.elapsedTime = this.timer.getElapsed();
      this.oldTime = performance.now();
    }
    return diff;
  }
}

export * from 'three/src/Three.js';
export { TimerClock as Clock };
export default {
  ...THREE,
  Clock: TimerClock,
};
