// Written in 2015 by Shaunak Kishore (kshaunak@gmail.com).
//
// To the extent possible under law, the author(s) have dedicated all copyright
// and related and neighboring rights to this software to the public domain
// worldwide. This software is distributed without any warranty.
this.makemeahanzi = this.makemeahanzi || {};

const kAngleThreshold = Math.PI / 6;
const kDistanceThreshold = 0.2;
const kMaxMissedSegments = 1;
const kMissedSegmentPenalty = 0.5;
const kNumCornersMatched = 2;

const util = {
  distance2: (point1, point2) => util.norm2(util.subtract(point1, point2)),
  norm2: (point) => point[0]*point[0] + point[1]*point[1],
  round: (point) => point.map(Math.round),
  subtract: (point1, point2) => [point1[0] - point2[0], point1[1] - point2[1]],
};

const angleDiff = (angle1, angle2) => {
  const diff = Math.abs(angle1 - angle2);
  return Math.min(diff, 2 * Math.PI - diff);
}

const getAngle = (median) => {
  const diff = util.subtract(median[median.length - 1], median[0]);
  return Math.atan2(diff[1], diff[0]);
}

const getBounds = (median) => {
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  median.map((point) => {
    min[0] = Math.min(min[0], point[0]);
    min[1] = Math.min(min[1], point[1]);
    max[0] = Math.max(max[0], point[0]);
    max[1] = Math.max(max[1], point[1]);
  });
  return [min, max];
}

const getMidpoint = (median) => {
  const bounds = getBounds(median);
  return [(bounds[0][0] + bounds[1][0]) / 2,
          (bounds[0][1] + bounds[1][1]) / 2];
}

const performAlignment = (source, target) => {
  const memo = [_.range(source.length).map((j) => j > 0 ? -Infinity : 0)];
  for (let i = 1; i < target.length; i++) {
    const row = [-Infinity];
    for (let j = 1; j < source.length; j++) {
      let best_value = -Infinity;
      const start = Math.max(j - kMaxMissedSegments - 1, 0);
      for (let k = start; k < j; k++) {
        if (memo[i - 1][k] === -Infinity) continue;
        const score = scorePairing(
            [source[k], source[j]], [target[i - 1], target[i]]);
        const penalty = (j - k - 1) * kMissedSegmentPenalty;
        best_value = Math.max(best_value, score + memo[i - 1][k] - penalty);
      }
      row.push(best_value);
    }
    memo.push(row);
  }
  const result = {score: -Infinity, source: null, target: null};
  const min_matched = Math.min(target.length - 1, kNumCornersMatched);
  for (let i = min_matched; i < target.length; i++) {
    const penalty = (target.length - i - 1) * kMissedSegmentPenalty;
    const score = memo[i][source.length - 1] - penalty;
    if (score > result.score) {
      result.score = score;
      result.source = [source[0], source[source.length - 1]];
      result.target = [target[0], target[i]];
    }
  }
  return result;
}

const scorePairing = (source, target) => {
  // TODO(skishore): We might want to include segment length in this score.
  const angle = angleDiff(getAngle(source), getAngle(target));
  const distance = Math.sqrt(util.distance2(
      getMidpoint(source), getMidpoint(target)));
  if (angle > kAngleThreshold || distance > kDistanceThreshold) {
    return -Infinity;
  }
  return -(angle + distance);
}

this.makemeahanzi.recognize = (source, target) => {
  // TODO(skishore): We should take the indices of the target here so that we
  // can penalize scores for strokes that are out of order.
  //
  // TODO(skishore): If the stroke is backwards we warn the user.
  //
  // TODO(skishore): We should detect missing hooks and warn the user.
  return performAlignment(source, target);
}