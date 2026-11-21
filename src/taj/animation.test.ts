import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_STAGES, CLOUD_FIELD_BOUNDS, TAJ_DIMS, TOTAL_BUILD_DURATION } from './config';
import {
  computeBirdFlightPose,
  computeRiseTransform,
  computeSprinklerIntensity,
  computeTreeBreezeSway,
  evaluateBuildStages,
  getActiveBuildLabel,
  getSubStageProgress,
  SPRINKLER_CYCLE_PERIOD,
  wrapCloudX,
} from './animation';
import {
  clampFirstPersonPosition,
  computeLookAngles,
  computeWalkBobOffset,
  getGroundHeightAt,
} from './navigation';

test('total building animation duration is strictly under 10 seconds', () => {
  assert.ok(TOTAL_BUILD_DURATION > 0 && TOTAL_BUILD_DURATION < 10);
  const lastStage = BUILD_STAGES[BUILD_STAGES.length - 1];
  assert.equal(lastStage.end, TOTAL_BUILD_DURATION);
});

test('all build stages start at 0, advance monotonically, and finish at 1', () => {
  const atZero = evaluateBuildStages(0);
  const atMid = evaluateBuildStages(TOTAL_BUILD_DURATION * 0.5);
  const atEnd = evaluateBuildStages(TOTAL_BUILD_DURATION);

  for (const stage of BUILD_STAGES) {
    assert.equal(atZero[stage.id], 0, `${stage.id} must be 0 at t=0`);
    assert.ok(
      atMid[stage.id] >= atZero[stage.id] && atMid[stage.id] <= atEnd[stage.id],
      `${stage.id} must be monotonic`,
    );
    assert.equal(atEnd[stage.id], 1, `${stage.id} must be 1 at end`);
  }

  // Architectural construction order: garden/plinth complete before dome finishes
  assert.ok(atMid.garden > atMid.dome);
  assert.ok(atMid.plinth > atMid.dome);
});

test('active build label reflects construction sequence and completion', () => {
  assert.equal(getActiveBuildLabel(0), BUILD_STAGES[0].label);
  assert.match(getActiveBuildLabel(TOTAL_BUILD_DURATION), /Complete/i);
});

test('staggered sub-stage progress orders children smoothly', () => {
  const first = getSubStageProgress(0.35, 0, 4);
  const last = getSubStageProgress(0.35, 3, 4);
  assert.ok(first > last);
  assert.equal(getSubStageProgress(0, 0, 4), 0);
  assert.equal(getSubStageProgress(1, 3, 4), 1);
});

test('rise transform hides before start and settles cleanly at rest', () => {
  const hidden = computeRiseTransform(0, 6);
  assert.equal(hidden.visible, false);

  const settled = computeRiseTransform(1, 6);
  assert.equal(settled.visible, true);
  assert.equal(settled.offsetY, 0);
  assert.equal(settled.scaleY, 1);
  assert.equal(settled.scaleXZ, 1);
});

test('cloud wrapping keeps drifting clouds inside sky bounds seamlessly', () => {
  const x1 = wrapCloudX(200, 10, 12);
  assert.ok(x1 >= CLOUD_FIELD_BOUNDS.minX && x1 <= CLOUD_FIELD_BOUNDS.maxX);
  const x2 = wrapCloudX(-220, -15, 5);
  assert.ok(x2 >= CLOUD_FIELD_BOUNDS.minX && x2 <= CLOUD_FIELD_BOUNDS.maxX);
});

test('tree breeze sway is zero when disabled and gently bounded when active', () => {
  const still = computeTreeBreezeSway(10, 20, 3.5, 0);
  assert.equal(still.rotX, 0);
  assert.equal(still.rotZ, 0);

  const swaying = computeTreeBreezeSway(10, 20, 3.5, 1.0, 1.2);
  assert.ok(Math.abs(swaying.rotZ) > 0 && Math.abs(swaying.rotZ) < 0.12);
  assert.ok(Math.abs(swaying.rotX) < 0.08);
});

test('first-person ground elevation steps across garden, sandstone terrace, and marble plinth', () => {
  assert.ok(getGroundHeightAt(8, 80) < 0.2, 'garden floor near 0m');
  assert.equal(getGroundHeightAt(38, -36), TAJ_DIMS.sandstoneTerraceH, 'riverfront terrace elevation');
  assert.equal(getGroundHeightAt(0, 24), TAJ_DIMS.plinthTopY, 'white marble plinth elevation');
  const midStair = getGroundHeightAt(0, TAJ_DIMS.plinthD * 0.5 + 2.0);
  assert.ok(midStair > TAJ_DIMS.sandstoneTerraceH && midStair < TAJ_DIMS.plinthTopY);
});

test('first-person collision prevents walking into mausoleum walls or off the Yamuna river wall', () => {
  const pushedOut = clampFirstPersonPosition(2, 3);
  assert.ok(
    Math.abs(pushedOut.x) >= TAJ_DIMS.mausoleumW * 0.5 || Math.abs(pushedOut.z) >= TAJ_DIMS.mausoleumW * 0.5,
  );
  const riverSafe = clampFirstPersonPosition(20, -90);
  assert.ok(riverSafe.z >= -39.0, 'walker stays safely on riverfront terrace above Yamuna River');
  const onPlatform = clampFirstPersonPosition(0, 103.5);
  assert.equal(onPlatform.x, 0);
  assert.equal(onPlatform.z, 103.5);
});

test('first-person head-bob and look angle helpers behave predictably', () => {
  assert.equal(computeWalkBobOffset(2.5, 0), 0);
  assert.ok(Math.abs(computeWalkBobOffset(Math.PI * 0.5, 1)) <= 0.05);
  const forward = computeLookAngles([0, 1.8, 100], [0, 15, 0]);
  assert.ok(Math.abs(forward.yaw) < 0.001);
  assert.ok(forward.pitch > 0.05 && forward.pitch < 0.35);
});

test('intermittent fountain sprinklers alternate cleanly between active spraying and calm off periods', () => {
  const spraying = computeSprinklerIntensity(4.0, 0, 20);
  const ramping = computeSprinklerIntensity(0.7, 0, 20);
  const off = computeSprinklerIntensity(12.0, 0, 20);
  const wrappedSpraying = computeSprinklerIntensity(4.0 + SPRINKLER_CYCLE_PERIOD, 0, 20);

  assert.ok(spraying > 0.8, 'should actively spray during ON phase');
  assert.ok(ramping > 0.1 && ramping < 0.9, 'should ramp smoothly rather than snapping');
  assert.equal(off, 0, 'should turn completely off during calm mirror phase');
  assert.ok(Math.abs(wrappedSpraying - spraying) < 0.15, 'cycle repeats smoothly');
});

test('flying birds stay airborne with bounded banking and smooth flapping/gliding wings', () => {
  const spec = {
    centerX: 0,
    centerZ: 12,
    radiusX: 28,
    radiusZ: 24,
    baseAltitude: 26,
    altitudeWave: 2.2,
    angularSpeed: 0.2,
    phase: 0.5,
    direction: 1 as const,
    figureEightAmp: 4.5,
    flapSpeed: 9.0,
    wingSpan: 1.0,
  };

  let minWing = Infinity;
  let maxWing = -Infinity;
  for (let t = 0; t <= 12; t += 0.25) {
    const pose = computeBirdFlightPose(spec, t);
    assert.ok(pose.y > 18, 'bird remains safely airborne');
    assert.ok(Math.abs(pose.pitch) <= 0.45);
    assert.ok(Math.abs(pose.bank) <= 0.6);
    minWing = Math.min(minWing, pose.wingAngle);
    maxWing = Math.max(maxWing, pose.wingAngle);
  }
  assert.ok(maxWing - minWing > 0.4, 'bird wings visibly flap over time');
});
